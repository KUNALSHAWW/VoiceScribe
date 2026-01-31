/**
 * Soniox Mock WebSocket Server
 * Simulates Soniox transcription API for testing
 */

const { WebSocketServer } = require('ws');

class SonioxMock {
    constructor(port = 8788) {
        this.port = port;
        this.server = null;
        this.connections = [];
    }

    start() {
        return new Promise((resolve, reject) => {
            this.server = new WebSocketServer({ port: this.port });
            
            this.server.on('listening', () => {
                console.log(`[SonioxMock] Listening on port ${this.port}`);
                resolve();
            });

            this.server.on('error', (err) => {
                console.error('[SonioxMock] Server error:', err);
                reject(err);
            });

            this.server.on('connection', (ws) => {
                this.handleConnection(ws);
            });
        });
    }

    handleConnection(ws) {
        console.log('[SonioxMock] Client connected');
        this.connections.push(ws);
        
        let configured = false;
        let audioChunkCount = 0;
        let totalBytes = 0;
        const words = [];

        ws.on('message', (data) => {
            if (typeof data === 'string' || data instanceof Buffer && data.toString().startsWith('{')) {
                // JSON message
                try {
                    const msg = JSON.parse(data.toString());
                    
                    if (msg.api_key) {
                        // Configuration message
                        console.log('[SonioxMock] Received config:', {
                            model: msg.model,
                            audio_format: msg.audio_format,
                            sample_rate: msg.sample_rate_hertz
                        });
                        configured = true;
                    }
                    
                    if (msg.end_of_stream) {
                        console.log('[SonioxMock] End of stream received');
                        
                        // Send final transcript
                        const finalWords = this.generateFinalTranscript(totalBytes);
                        ws.send(JSON.stringify({
                            words: finalWords
                        }));
                        
                        // Close connection gracefully
                        setTimeout(() => ws.close(1000, 'Complete'), 100);
                    }
                } catch (e) {
                    console.warn('[SonioxMock] Invalid JSON:', data.toString().substring(0, 100));
                }
            } else {
                // Binary audio data
                audioChunkCount++;
                totalBytes += data.length;
                
                // Simulate partial transcripts every few chunks
                if (configured && audioChunkCount % 3 === 0) {
                    const partialWords = this.generatePartialTranscript(audioChunkCount);
                    ws.send(JSON.stringify({ words: partialWords }));
                }
            }
        });

        ws.on('close', () => {
            console.log(`[SonioxMock] Client disconnected (${audioChunkCount} chunks, ${totalBytes} bytes)`);
            this.connections = this.connections.filter(c => c !== ws);
        });

        ws.on('error', (err) => {
            console.error('[SonioxMock] Connection error:', err);
        });
    }

    generatePartialTranscript(chunkNum) {
        const phrases = [
            'Hello',
            'Hello world',
            'Hello world this',
            'Hello world this is',
            'Hello world this is a',
            'Hello world this is a test',
        ];
        
        const idx = Math.min(chunkNum - 1, phrases.length - 1);
        const words = phrases[idx].split(' ').map((word, i) => ({
            text: word,
            start_ms: i * 200,
            end_ms: (i + 1) * 200,
            confidence: 0.95,
            is_final: false
        }));
        
        return words;
    }

    generateFinalTranscript(totalBytes) {
        // Generate realistic final transcript
        const sentence = 'Hello world this is a test of the real time transcription system';
        const words = sentence.split(' ');
        
        return words.map((word, i) => ({
            text: word,
            start_ms: i * 250,
            end_ms: (i + 1) * 250 - 50,
            confidence: 0.92 + Math.random() * 0.07,
            is_final: true
        }));
    }

    stop() {
        return new Promise((resolve) => {
            // Close all connections
            for (const conn of this.connections) {
                try {
                    conn.close(1000, 'Server shutdown');
                } catch (e) {}
            }
            this.connections = [];
            
            if (this.server) {
                this.server.close(() => {
                    console.log('[SonioxMock] Server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

// Run standalone
if (require.main === module) {
    const mock = new SonioxMock(8788);
    mock.start().then(() => {
        console.log('[SonioxMock] Running standalone mode. Press Ctrl+C to stop.');
    });
    
    process.on('SIGINT', async () => {
        await mock.stop();
        process.exit(0);
    });
}

module.exports = { SonioxMock };
