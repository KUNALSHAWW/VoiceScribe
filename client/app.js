/**
 * VoiceScribe - Real-time Transcription Client
 * AudioWorklet-based PCM capture with fallback to ScriptProcessor
 * Streams 16-bit signed linear PCM @ 16kHz to Cloudflare Worker
 */

class VoiceScribe {
    constructor() {
        // DOM Elements
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
        this.visualizerCtx = this.audioVisualizer ? this.audioVisualizer.getContext('2d') : null;

        // State
        this.isRecording = false;
        this.audioStream = null;
        this.audioContext = null;
        this.analyser = null;
        this.socket = null;
        this.recordingStartTime = null;
        this.timerInterval = null;
        this.animationFrameId = null;
        this.sessionId = null;

        // Transcript state
        this.transcript = '';
        this.interimTranscript = '';
        this.segments = [];
        this.partialCount = 0;

        // Audio processing
        this.workletNode = null;
        this.scriptProcessor = null;
        this.sourceNode = null;
        this.useWorklet = true;

        // Configuration
        this.targetSampleRate = 16000;

        // WebSocket reconnection
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;

        this.init();
    }

    /**
     * Generate UUID v4 for session tracking
     */
    generateUUID() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Get Worker WebSocket URL
     */
    getWorkerUrl() {
        const loc = window.location;
        const isDev = loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
        
        if (isDev) {
            return 'ws://127.0.0.1:8787/ws';
        }
        
        // Production URL - uses same host
        const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${loc.host}/ws`;
    }

    /**
     * Initialize application
     */
    async init() {
        this.recordBtn.addEventListener('click', () => this.toggleRecording());
        this.copyBtn.addEventListener('click', () => this.copyTranscript());
        
        if (this.audioVisualizer) {
            this.setupCanvas();
            this.drawIdleVisualizer();
        }
        
        this.updateStatus('Ready to record', 'ready');

        // Check AudioWorklet support
        this.useWorklet = typeof AudioWorkletNode !== 'undefined' && 
                          typeof AudioContext !== 'undefined' &&
                          typeof AudioContext.prototype.audioWorklet !== 'undefined';
        
        if (!this.useWorklet) {
            console.warn('[Client] AudioWorklet not supported, will use ScriptProcessorNode fallback');
        }
    }

    /**
     * Setup canvas for audio visualization
     */
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

    /**
     * Draw idle state visualizer - monochrome theme
     */
    drawIdleVisualizer() {
        if (!this.visualizerCtx) return;
        
        const ctx = this.visualizerCtx;
        const size = this.canvasSize;
        const center = size / 2;
        const radius = size / 2 - 20;
        
        ctx.clearRect(0, 0, size, size);
        
        // Radial gradient background - monochrome
        const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
        gradient.addColorStop(1, 'rgba(180, 180, 180, 0)');
        
        ctx.beginPath();
        ctx.arc(center, center, radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Outer ring
        ctx.beginPath();
        ctx.arc(center, center, radius - 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    /**
     * Draw active recording visualizer - monochrome
     */
    drawActiveVisualizer() {
        if (!this.analyser || !this.isRecording || !this.visualizerCtx) {
            this.drawIdleVisualizer();
            return;
        }
        
        const ctx = this.visualizerCtx;
        const size = this.canvasSize;
        const center = size / 2;
        const radius = size / 2 - 30;
        
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(dataArray);
        
        ctx.clearRect(0, 0, size, size);
        
        // Draw frequency bars in circular pattern
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
            
            // White/gray gradient based on intensity
            const intensity = value / 255;
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + intensity * 0.7})`;
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.stroke();
        }
        
        // Center circle with glossy effect
        const centerGrad = ctx.createRadialGradient(center - 5, center - 5, 0, center, center, 30);
        centerGrad.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
        centerGrad.addColorStop(1, 'rgba(200, 200, 200, 0.2)');
        
        ctx.beginPath();
        ctx.arc(center, center, 30, 0, Math.PI * 2);
        ctx.fillStyle = centerGrad;
        ctx.fill();
        
        this.animationFrameId = requestAnimationFrame(() => this.drawActiveVisualizer());
    }

    /**
     * Toggle recording state
     */
    async toggleRecording() {
        if (this.isRecording) {
            await this.stopRecording();
        } else {
            await this.startRecording();
        }
    }

    /**
     * Start recording audio
     */
    async startRecording() {
        try {
            this.updateStatus('Requesting microphone...', 'connecting');
            this.updateConnectionStatus('connecting');

            // Reset state
            this.transcript = '';
            this.interimTranscript = '';
            this.segments = [];
            this.partialCount = 0;
            this.sessionId = this.generateUUID();
            this.reconnectAttempts = 0;

            // Get audio stream
            this.audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: { ideal: 48000 },
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            // Setup AudioContext
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContextClass();
            
            console.log(`[Client] AudioContext sample rate: ${this.audioContext.sampleRate}Hz`);
            console.log(`[Client] Target sample rate: ${this.targetSampleRate}Hz`);
            
            // Create analyser for visualization
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            
            // Create source node
            this.sourceNode = this.audioContext.createMediaStreamSource(this.audioStream);
            this.sourceNode.connect(this.analyser);

            // Connect to Worker WebSocket
            this.updateStatus('Connecting to server...', 'connecting');
            await this.connectToWorker();

            // Setup audio capture
            if (this.useWorklet) {
                await this.setupAudioWorklet();
            } else {
                this.setupScriptProcessor();
            }

            // UI updates
            this.isRecording = true;
            this.recordBtn.classList.add('recording');
            this.recordingCard.classList.add('recording');
            this.updateStatus('Recording... Speak now', 'recording');
            this.startTimer();
            this.drawActiveVisualizer();
            this.showPlaceholder();

        } catch (error) {
            console.error('[Client] Error starting recording:', error);
            this.updateStatus(`Error: ${error.message}`, 'error');
            this.updateConnectionStatus('disconnected');
            this.cleanup();
        }
    }

    /**
     * Setup AudioWorklet for PCM capture
     */
    async setupAudioWorklet() {
        try {
            await this.audioContext.audioWorklet.addModule('pcm-worklet.js');
            
            this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-processor');
            
            this.workletNode.port.onmessage = (event) => {
                if (event.data && event.data.length) {
                    this.processAudioSamples(event.data);
                }
            };
            
            this.sourceNode.connect(this.workletNode);
            this.workletNode.connect(this.audioContext.destination);
            
            console.log('[Client] AudioWorklet setup complete');
        } catch (error) {
            console.warn('[Client] AudioWorklet setup failed, using ScriptProcessor:', error);
            this.useWorklet = false;
            this.setupScriptProcessor();
        }
    }

    /**
     * Setup ScriptProcessor fallback
     */
    setupScriptProcessor() {
        const bufferSize = 4096;
        this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
        
        this.scriptProcessor.onaudioprocess = (event) => {
            if (!this.isRecording) return;
            const inputData = event.inputBuffer.getChannelData(0);
            this.processAudioSamples(new Float32Array(inputData));
        };
        
        this.sourceNode.connect(this.scriptProcessor);
        this.scriptProcessor.connect(this.audioContext.destination);
        
        console.log('[Client] ScriptProcessor setup complete (fallback mode)');
    }

    /**
     * Process audio samples: downsample and convert to Int16
     */
    processAudioSamples(float32Samples) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        
        const sourceSampleRate = this.audioContext.sampleRate;
        let samples = float32Samples;
        
        // Downsample if needed
        if (sourceSampleRate !== this.targetSampleRate) {
            samples = this.downsample(float32Samples, sourceSampleRate, this.targetSampleRate);
        }
        
        // Convert Float32 to Int16
        const int16Samples = this.float32ToInt16(samples);
        
        // Send binary data over WebSocket
        this.socket.send(int16Samples.buffer);
    }

    /**
     * Downsample audio using linear interpolation
     */
    downsample(samples, sourceSampleRate, targetSampleRate) {
        if (sourceSampleRate === targetSampleRate) return samples;
        
        const ratio = sourceSampleRate / targetSampleRate;
        const newLength = Math.round(samples.length / ratio);
        const result = new Float32Array(newLength);
        
        for (let i = 0; i < newLength; i++) {
            const srcIndex = i * ratio;
            const srcIndexFloor = Math.floor(srcIndex);
            const srcIndexCeil = Math.min(srcIndexFloor + 1, samples.length - 1);
            const fraction = srcIndex - srcIndexFloor;
            
            result[i] = samples[srcIndexFloor] * (1 - fraction) + samples[srcIndexCeil] * fraction;
        }
        
        return result;
    }

    /**
     * Convert Float32 [-1.0, 1.0] to Int16 [-32768, 32767]
     */
    float32ToInt16(float32Array) {
        const int16Array = new Int16Array(float32Array.length);
        
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        return int16Array;
    }

    /**
     * Connect to Cloudflare Worker WebSocket
     */
    async connectToWorker() {
        return new Promise((resolve, reject) => {
            const workerUrl = this.getWorkerUrl();
            console.log(`[Client] Connecting to: ${workerUrl}`);
            
            this.socket = new WebSocket(workerUrl);

            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 10000);

            this.socket.onopen = () => {
                clearTimeout(timeout);
                console.log('[Client] Connected to Edge Worker');
                this.updateConnectionStatus('connected');
                
                // Send start message
                this.socket.send(JSON.stringify({
                    type: 'start',
                    session_id: this.sessionId
                }));
                
                resolve();
            };

            this.socket.onmessage = (event) => {
                this.handleWorkerMessage(event.data);
            };

            this.socket.onclose = (event) => {
                console.log(`[Client] WebSocket closed: code=${event.code}`);
                this.updateConnectionStatus('disconnected');
                
                if (this.isRecording && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.attemptReconnect();
                }
            };

            this.socket.onerror = (error) => {
                clearTimeout(timeout);
                console.error('[Client] WebSocket error:', error);
                reject(error);
            };
        });
    }

    /**
     * Attempt reconnection with exponential backoff
     */
    async attemptReconnect() {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`[Client] Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`);
        this.updateStatus(`Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`, 'connecting');
        
        await new Promise(r => setTimeout(r, delay));
        
        try {
            await this.connectToWorker();
            this.updateStatus('Reconnected - Recording...', 'recording');
        } catch (error) {
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.updateStatus('Connection lost. Please restart.', 'error');
                await this.stopRecording();
            }
        }
    }

    /**
     * Handle messages from Worker
     */
    handleWorkerMessage(data) {
        try {
            const msg = JSON.parse(data);
            
            switch (msg.type) {
                case 'partial_transcript':
                    this.handlePartialTranscript(msg);
                    break;
                    
                case 'full_transcript':
                    this.handleFullTranscript(msg);
                    break;
                    
                case 'error':
                    console.error('[Client] Server error:', msg.message);
                    this.updateStatus(`Error: ${msg.message}`, 'error');
                    break;
                    
                case 'connected':
                    console.log('[Client] Worker confirmed connection');
                    break;
                    
                default:
                    // Handle legacy Soniox format
                    if (msg.text !== undefined) {
                        this.handleLegacyTranscript(msg);
                    }
            }
        } catch (e) {
            console.warn('[Client] Failed to parse message:', data);
        }
    }

    /**
     * Handle partial transcript updates
     */
    handlePartialTranscript(msg) {
        this.partialCount++;
        this.interimTranscript = msg.text || '';
        
        if (msg.segments) {
            this.mergeSegments(msg.segments);
        }
        
        this.displayTranscript();
    }

    /**
     * Handle final consolidated transcript
     */
    handleFullTranscript(msg) {
        console.log('[Client] Received full transcript:', msg);
        
        this.transcript = msg.transcript || '';
        this.segments = msg.segments || [];
        this.interimTranscript = '';
        
        this.displayTranscript();
        
        if (this.transcript.trim()) {
            this.copyBtn.disabled = false;
        }
        
        if (msg.stats) {
            console.log(`[Client] Stats: ${msg.stats.partial_count} partials, ${msg.stats.duration_s}s duration`);
        }
    }

    /**
     * Handle legacy transcript format
     */
    handleLegacyTranscript(msg) {
        const text = msg.text;
        const isFinal = msg.isFinal === true || msg.is_final === true;
        
        if (isFinal && text && text.trim()) {
            this.transcript += (this.transcript ? ' ' : '') + text.trim();
            this.interimTranscript = '';
        } else if (!isFinal && text) {
            this.interimTranscript = text;
        }
        
        this.displayTranscript();
    }

    /**
     * Merge new segments
     */
    mergeSegments(newSegments) {
        for (const newSeg of newSegments) {
            const existingIdx = this.segments.findIndex(
                s => Math.abs(s.start - newSeg.start) < 0.1
            );
            
            if (existingIdx >= 0) {
                this.segments[existingIdx] = newSeg;
            } else {
                this.segments.push(newSeg);
            }
        }
        
        this.segments.sort((a, b) => a.start - b.start);
    }

    /**
     * Display transcript in UI
     */
    displayTranscript() {
        const finalText = this.transcript;
        const interimText = this.interimTranscript;

        if (!finalText && !interimText) {
            this.showPlaceholder();
            return;
        }

        let html = '';
        if (finalText) {
            html += `<span class="final-text">${this.escapeHtml(finalText)}</span>`;
        }
        if (interimText) {
            html += `<span class="interim-text">${this.escapeHtml(interimText)}</span>`;
        }
        html += '<span class="streaming-cursor"></span>';

        this.transcriptContent.innerHTML = `<p class="transcript-text">${html}</p>`;
        this.updateCounts(finalText + interimText);
    }

    /**
     * Show placeholder text
     */
    showPlaceholder() {
        this.transcriptContent.innerHTML = `
            <div class="transcript-placeholder loading-shimmer">
                <p>Listening for speech...</p>
            </div>`;
        this.copyBtn.disabled = true;
        this.updateCounts('');
    }

    /**
     * Stop recording and request final transcript
     */
    async stopRecording() {
        if (!this.isRecording) return;

        this.updateStatus('Processing final transcript...', 'processing');
        this.isRecording = false;

        // Stop audio processing
        if (this.workletNode) {
            this.workletNode.disconnect();
        }
        if (this.scriptProcessor) {
            this.scriptProcessor.disconnect();
        }

        // Send finalize and wait for response
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type: 'finalize' }));
            await this.waitForFinalTranscript();
        }

        // UI updates
        this.recordBtn.classList.remove('recording');
        this.recordingCard.classList.remove('recording');
        this.stopTimer();

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.drawIdleVisualizer();

        // Final UI state
        if (this.transcript.trim()) {
            this.transcriptContent.innerHTML = `<p class="transcript-text final-text">${this.escapeHtml(this.transcript)}</p>`;
            this.copyBtn.disabled = false;
        } else {
            this.transcriptContent.innerHTML = `
                <div class="transcript-placeholder">
                    <p>No speech detected.</p>
                </div>`;
            this.copyBtn.disabled = true;
        }

        this.updateStatus('Recording complete', 'ready');
        this.cleanup();
    }

    /**
     * Wait for full transcript with timeout
     */
    waitForFinalTranscript() {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.log('[Client] Timeout waiting for full transcript');
                resolve();
            }, 5000);

            const originalHandler = this.handleWorkerMessage.bind(this);
            this.handleWorkerMessage = (data) => {
                originalHandler(data);
                try {
                    const msg = JSON.parse(data);
                    if (msg.type === 'full_transcript') {
                        clearTimeout(timeout);
                        this.handleWorkerMessage = originalHandler;
                        resolve();
                    }
                } catch (e) {}
            };
        });
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        if (this.socket) {
            if (this.socket.readyState === WebSocket.OPEN) {
                this.socket.close(1000, 'Recording stopped');
            }
            this.socket = null;
        }
        
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(t => t.stop());
            this.audioStream = null;
        }
        
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close().catch(() => {});
            this.audioContext = null;
        }
        
        this.workletNode = null;
        this.scriptProcessor = null;
        this.sourceNode = null;
        this.analyser = null;
    }

    /**
     * Start timer
     */
    startTimer() {
        this.recordingStartTime = Date.now();
        this.timerInterval = setInterval(() => {
            const elapsed = Date.now() - this.recordingStartTime;
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            this.timerText.textContent = 
                `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }, 1000);
    }

    /**
     * Stop timer
     */
    stopTimer() {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
        this.timerText.textContent = '00:00';
    }

    /**
     * Update status message
     */
    updateStatus(msg, state) {
        this.statusMessage.textContent = msg;
        this.statusMessage.className = `status-message status-${state}`;
    }

    /**
     * Update connection status
     */
    updateConnectionStatus(state) {
        this.connectionStatus.className = 'status-indicator ' + state;
        
        const texts = {
            connected: 'Connected',
            connecting: 'Connecting...',
            disconnected: 'Disconnected'
        };
        this.connectionText.textContent = texts[state] || state;
    }

    /**
     * Update counts
     */
    updateCounts(text) {
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        this.wordCount.textContent = `${words} words`;
        this.charCount.textContent = `${text.length} chars`;
    }

    /**
     * Copy transcript
     */
    async copyTranscript() {
        if (!this.transcript) return;
        
        try {
            await navigator.clipboard.writeText(this.transcript);
            this.copyBtn.classList.add('copied');
            setTimeout(() => this.copyBtn.classList.remove('copied'), 2000);
        } catch (e) {
            console.error('[Client] Copy failed:', e);
        }
    }

    /**
     * Escape HTML
     */
    escapeHtml(text) {
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.voiceScribe = new VoiceScribe();
});
