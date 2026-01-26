/**
 * VoiceScribe - Real-time Transcription Client
 * Uses Soniox WebSocket API via Cloudflare Worker
 */

class VoiceScribe {
    constructor() {
        this.recordBtn = document.getElementById('recordBtn');
        this.recordingCard = document.querySelector('.recording-card');
        this.timerText = document.querySelector('.timer-text');
        this.statusMessage = document.getElementById('statusMessage');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.connectionText = document.getElementById('connectionText');
        this.transcriptContent = document.getElementById('transcriptContent');
        this.copyBtn = document.getElementById('copyBtn');
        this.wordCount = document.getElementById('wordCount');
        this.charCount = document.getElementById('charCount');
        this.audioVisualizer = document.getElementById('audioVisualizer');
        this.visualizerCtx = this.audioVisualizer.getContext('2d');

        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioStream = null;
        this.audioContext = null;
        this.analyser = null;
        this.socket = null;
        this.recordingStartTime = null;
        this.timerInterval = null;
        this.animationFrameId = null;
        this.transcript = '';
        this.interimTranscript = '';

        this.init();
    }

    getWorkerUrl() {
        const loc = window.location;
        const isDev = loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
        
        // If running locally, point to Wrangler default port 8787
        if (isDev) {
            return 'ws://127.0.0.1:8787/ws';
        }
        
        // Production URL
        // REPLACE THIS WITH YOUR ACTUAL DEPLOYED WORKER URL
        return 'wss://voicescribe.workers.dev/ws';
    }

    init() {
        this.recordBtn.addEventListener('click', () => this.toggleRecording());
        this.copyBtn.addEventListener('click', () => this.copyTranscript());
        this.setupCanvas();
        this.drawIdleVisualizer();
        this.updateStatus('Ready to record', 'ready');
    }

    setupCanvas() {
        const size = 200;
        const dpr = window.devicePixelRatio || 1;
        this.audioVisualizer.width = size * dpr;
        this.audioVisualizer.height = size * dpr;
        this.audioVisualizer.style.width = `${size}px`;
        this.audioVisualizer.style.height = `${size}px`;
        this.visualizerCtx.scale(dpr, dpr);
        this.canvasSize = size;
    }

    drawIdleVisualizer() {
        const ctx = this.visualizerCtx;
        const size = this.canvasSize;
        const center = size / 2;
        const radius = size / 2 - 20;
        ctx.clearRect(0, 0, size, size);
        const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius);
        gradient.addColorStop(0, 'rgba(139, 92, 246, 0.2)');
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0)');
        ctx.beginPath();
        ctx.arc(center, center, radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(center, center, radius - 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.3)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    drawActiveVisualizer() {
        if (!this.analyser || !this.isRecording) { this.drawIdleVisualizer(); return; }
        const ctx = this.visualizerCtx;
        const size = this.canvasSize;
        const center = size / 2;
        const radius = size / 2 - 30;
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(dataArray);
        ctx.clearRect(0, 0, size, size);
        const bars = 64;
        const barWidth = (Math.PI * 2) / bars;
        const step = Math.floor(dataArray.length / bars);
        for (let i = 0; i < bars; i++) {
            const value = dataArray[i * step];
            const barHeight = (value / 255) * 40 + 5;
            const angle = i * barWidth - Math.PI / 2;
            const innerRadius = radius - 10;
            const x1 = center + Math.cos(angle) * innerRadius;
            const y1 = center + Math.sin(angle) * innerRadius;
            const x2 = center + Math.cos(angle) * (innerRadius + barHeight);
            const y2 = center + Math.sin(angle) * (innerRadius + barHeight);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = 'rgba(168, 85, 247, 0.8)';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(center, center, 30, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(168, 85, 247, 0.6)';
        ctx.fill();
        this.animationFrameId = requestAnimationFrame(() => this.drawActiveVisualizer());
    }

    async toggleRecording() {
        this.isRecording ? await this.stopRecording() : await this.startRecording();
    }

    async startRecording() {
        try {
            this.updateStatus('Requesting microphone...', 'connecting');
            this.updateConnectionStatus('connecting');

            // 1. Get audio stream
            this.audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            // 2. Setup Audio Context (Visualization)
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.audioContext.createMediaStreamSource(this.audioStream).connect(this.analyser);

            // 3. Connect to Edge Worker
            this.updateStatus('Connecting to server...', 'connecting');
            await this.connectToWorker();

            // 4. Setup MediaRecorder
            let mimeType = 'audio/webm';
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                mimeType = 'audio/webm;codecs=opus';
            }
            
            this.mediaRecorder = new MediaRecorder(this.audioStream, { mimeType });

            // 5. Data Handler (SAFE VERSION)
            this.mediaRecorder.ondataavailable = (e) => {
                // Only send if data exists AND socket is effectively OPEN
                if (e.data.size > 0 && this.socket && this.socket.readyState === WebSocket.OPEN) {
                    this.socket.send(e.data);
                }
            };

            // 6. Start Recording (250ms chunks)
            this.mediaRecorder.start(250);

            // 7. UI Updates
            this.isRecording = true;
            this.recordBtn.classList.add('recording');
            this.recordingCard.classList.add('recording');
            this.updateStatus('Recording... Speak now', 'recording');
            this.startTimer();
            this.drawActiveVisualizer();
            this.transcript = '';
            this.interimTranscript = '';
            this.showPlaceholder();

        } catch (error) {
            console.error('Error starting recording:', error);
            this.updateStatus(`Error: ${error.message}`, 'error');
            this.updateConnectionStatus('disconnected');
            this.cleanup();
        }
    }

    async connectToWorker() {
        return new Promise((resolve, reject) => {
            const workerUrl = this.getWorkerUrl();
            this.socket = new WebSocket(workerUrl);

            this.socket.onopen = () => {
                console.log('Connected to Edge Worker');
                this.updateConnectionStatus('connected');
                resolve();
            };

            this.socket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                // ERROR HANDLING: Handle messages from server
                if (data.type === 'error') {
                    console.error("API Error:", data.message);
                    this.updateStatus(`Error: ${data.message}`, 'error');
                    this.stopRecording(); 
                } 
                else {
                    this.handleTranscript(data);
                }
            };

            this.socket.onclose = (event) => {
                console.log('WebSocket closed:', event.code);
                this.updateConnectionStatus('disconnected');
            };

            this.socket.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        });
    }

    handleTranscript(data) {
        // Handle interim and final transcripts
        const text = data.text;
        const isFinal = data.isFinal === true;

        if (isFinal && text && text.trim()) {
            this.transcript += (this.transcript ? ' ' : '') + text.trim();
            this.interimTranscript = '';
        } else if (!isFinal && text) {
            this.interimTranscript = text;
        }

        // Also handle legacy 'final' type if sent
        if (data.type === 'final' && data.text && data.text.trim()) {
            this.transcript = data.text;
            this.interimTranscript = '';
        }

        this.displayTranscript();
    }

    displayTranscript() {
        const finalText = this.transcript;
        const interimText = this.interimTranscript;

        if (!finalText && !interimText) return;

        let html = '';
        if (finalText) {
            html += `<span class="final-text">${this.escapeHtml(finalText)}</span>`;
        }
        if (interimText) {
            html += `<span class="interim-text" style="opacity: 0.6;">${this.escapeHtml(interimText)}</span>`;
        }
        html += '<span class="streaming-cursor"></span>';

        this.transcriptContent.innerHTML = `<p class="transcript-text">${html}</p>`;
        this.updateCounts(finalText + interimText);
    }

    showPlaceholder() {
        this.transcriptContent.innerHTML = '<div class="transcript-placeholder loading-shimmer"><p>Listening for speech...</p></div>';
        this.copyBtn.disabled = true;
        this.updateCounts('');
    }

    async stopRecording() {
        if (!this.isRecording) return;

        this.updateStatus('Processing...', 'processing');

        // Stop MediaRecorder
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }

        // Send stop signal safely
        if (this.socket) {
            if (this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({ type: 'stop' }));
                
                // Give it a moment to send final partials before closing
                await new Promise(r => setTimeout(r, 500)); 
                
                if(this.socket.readyState === WebSocket.OPEN) {
                    this.socket.close();
                }
            }
            this.socket = null;
        }

        this.isRecording = false;
        this.recordBtn.classList.remove('recording');
        this.recordingCard.classList.remove('recording');
        this.stopTimer();

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.drawIdleVisualizer();

        // Final UI cleanup
        if (this.transcript.trim()) {
            this.transcriptContent.innerHTML = `<p class="transcript-text">${this.escapeHtml(this.transcript)}</p>`;
            this.copyBtn.disabled = false;
        } else {
            this.transcriptContent.innerHTML = '<div class="transcript-placeholder"><p>No speech detected.</p></div>';
            this.copyBtn.disabled = true;
        }

        this.updateStatus('Recording complete', 'ready');
        this.cleanup();
    }

    cleanup() {
        if (this.socket) {
            if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
            this.socket = null;
        }
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(t => t.stop());
            this.audioStream = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        this.mediaRecorder = null;
        this.analyser = null;
    }

    startTimer() {
        this.recordingStartTime = Date.now();
        this.timerInterval = setInterval(() => {
            const elapsed = Date.now() - this.recordingStartTime;
            this.timerText.textContent = `${String(Math.floor(elapsed / 60000)).padStart(2, '0')}:${String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0')}`;
        }, 1000);
    }

    stopTimer() {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
        this.timerText.textContent = '00:00';
    }

    updateStatus(msg, state) {
        this.statusMessage.textContent = msg;
    }

    updateConnectionStatus(state) {
        this.connectionStatus.className = 'status-indicator' + (state === 'connecting' ? ' connecting' : state === 'disconnected' ? ' error' : '');
        this.connectionText.textContent = state === 'connected' ? 'Connected' : state === 'connecting' ? 'Connecting...' : 'Disconnected';
    }

    updateCounts(text) {
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        this.wordCount.textContent = `${words} words`;
        this.charCount.textContent = `${text.length} chars`;
    }

    async copyTranscript() {
        if (!this.transcript) return;
        await navigator.clipboard.writeText(this.transcript);
        this.copyBtn.classList.add('copied');
        setTimeout(() => this.copyBtn.classList.remove('copied'), 2000);
    }

    escapeHtml(text) {
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.voiceScribe = new VoiceScribe();
});