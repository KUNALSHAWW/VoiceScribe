/**
 * VoiceScribe - Cloudflare Worker
 * WebSocket proxy between browser clients and Soniox Speech API
 * Handles PCM streaming, incremental transcripts, and final aggregation
 */

// Soniox WebSocket endpoint
const SONIOX_WS_URL = 'wss://api.soniox.com/transcribe-websocket';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        // Handle WebSocket upgrade for /ws path
        if (url.pathname === '/ws') {
            const upgradeHeader = request.headers.get('Upgrade');
            if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
                return new Response('Expected Upgrade: websocket', { status: 426 });
            }

            const [client, server] = Object.values(new WebSocketPair());
            ctx.waitUntil(handleSession(server, env));
            return new Response(null, { status: 101, webSocket: client });
        }

        // Serve static files or return 404
        return new Response('VoiceScribe Worker - Use /ws for WebSocket', { status: 200 });
    },
};

/**
 * Handle a WebSocket session
 */
async function handleSession(clientWs, env) {
    clientWs.accept();
    console.log('[Worker] Client connected');

    // Validate API key
    if (!env.SONIOX_API_KEY) {
        console.error('[Worker] FATAL: SONIOX_API_KEY is missing');
        safeSend(clientWs, JSON.stringify({ 
            type: 'error', 
            message: 'Server configuration error: Missing API key' 
        }));
        clientWs.close(1011, 'Server Config Error');
        return;
    }

    // Session state
    const state = {
        sessionId: null,
        sonioxWs: null,
        isFinalized: false,
        finalTranscriptParts: [],
        segments: [],
        partialCount: 0,
        startTime: Date.now(),
        reconnectAttempts: 0,
        maxReconnectAttempts: 3
    };

    // Handle client messages
    clientWs.addEventListener('message', async (event) => {
        try {
            if (typeof event.data === 'string') {
                await handleClientJson(event.data, clientWs, state, env);
            } else {
                // Binary PCM data - forward to Soniox
                await handleClientBinary(event.data, state);
            }
        } catch (error) {
            console.error('[Worker] Error handling client message:', error);
        }
    });

    clientWs.addEventListener('close', () => {
        console.log('[Worker] Client disconnected');
        closeSonioxConnection(state);
    });

    clientWs.addEventListener('error', (e) => {
        console.error('[Worker] Client WebSocket error:', e);
    });

    // Wait for session to complete
    await new Promise(resolve => {
        clientWs.addEventListener('close', resolve);
    });
}

/**
 * Handle JSON messages from client
 */
async function handleClientJson(data, clientWs, state, env) {
    let msg;
    try {
        msg = JSON.parse(data);
    } catch (e) {
        console.warn('[Worker] Invalid JSON from client');
        return;
    }

    console.log('[Worker] Received:', msg.type);

    switch (msg.type) {
        case 'start':
            state.sessionId = msg.session_id || 'unknown';
            state.startTime = Date.now();
            state.finalTranscriptParts = [];
            state.segments = [];
            state.partialCount = 0;
            state.isFinalized = false;
            
            // Connect to Soniox
            await connectToSoniox(clientWs, state, env);
            break;

        case 'finalize':
            console.log('[Worker] Finalize requested');
            state.isFinalized = true;
            await finalizeSonioxAndSendResult(clientWs, state);
            break;

        default:
            console.warn('[Worker] Unknown message type:', msg.type);
    }
}

/**
 * Handle binary PCM data from client
 */
async function handleClientBinary(data, state) {
    if (!state.sonioxWs || state.sonioxWs.readyState !== WebSocket.OPEN) {
        return;
    }
    
    // Forward binary PCM to Soniox
    try {
        state.sonioxWs.send(data);
    } catch (e) {
        console.error('[Worker] Failed to send to Soniox:', e);
    }
}

/**
 * Connect to Soniox WebSocket API
 */
async function connectToSoniox(clientWs, state, env) {
    return new Promise((resolve, reject) => {
        console.log('[Worker] Connecting to Soniox...');
        console.log('[Worker] API Key present:', !!env.SONIOX_API_KEY);
        console.log('[Worker] API Key length:', env.SONIOX_API_KEY?.length || 0);
        
        try {
            state.sonioxWs = new WebSocket(SONIOX_WS_URL);
        } catch (e) {
            console.error('[Worker] Failed to create Soniox WebSocket:', e);
            safeSend(clientWs, JSON.stringify({ 
                type: 'error', 
                message: 'Failed to connect to transcription service' 
            }));
            reject(e);
            return;
        }

        state.sonioxWs.addEventListener('open', () => {
            console.log('[Worker] Connected to Soniox, sending config...');
            
            // Send Soniox configuration for PCM audio
            const config = {
                api_key: env.SONIOX_API_KEY,
                model: 'en_v2',
                audio_format: 'pcm_s16le',
                sample_rate_hertz: 16000,
                num_audio_channels: 1,
                include_nonfinal: true
            };
            
            console.log('[Worker] Sending config (api_key hidden):', { ...config, api_key: '***' });
            safeSend(state.sonioxWs, JSON.stringify(config));
            safeSend(clientWs, JSON.stringify({ type: 'connected' }));
            resolve();
        });

        state.sonioxWs.addEventListener('message', (event) => {
            console.log('[Worker] Soniox message received:', typeof event.data === 'string' ? event.data.substring(0, 200) : 'binary');
            handleSonioxMessage(event.data, clientWs, state);
        });

        state.sonioxWs.addEventListener('close', (e) => {
            console.log(`[Worker] Soniox closed: code=${e.code}, reason=${e.reason || 'None'}`);
            
            // Handle error closures
            if (e.code !== 1000 && e.code !== 1005 && !state.isFinalized) {
                const errorMsg = e.reason || 'Connection closed unexpectedly';
                safeSend(clientWs, JSON.stringify({ 
                    type: 'error', 
                    message: `Transcription error: ${errorMsg}` 
                }));
            }
        });

        state.sonioxWs.addEventListener('error', (e) => {
            console.error('[Worker] Soniox WebSocket error event:', e.message || e);
        });

        // Timeout for connection
        setTimeout(() => {
            if (state.sonioxWs && state.sonioxWs.readyState === WebSocket.CONNECTING) {
                console.error('[Worker] Soniox connection timeout');
                state.sonioxWs.close();
                safeSend(clientWs, JSON.stringify({ 
                    type: 'error', 
                    message: 'Connection to transcription service timed out' 
                }));
                reject(new Error('Connection timeout'));
            }
        }, 10000);
    });
}

/**
 * Handle messages from Soniox
 */
function handleSonioxMessage(data, clientWs, state) {
    let msg;
    try {
        msg = JSON.parse(data);
    } catch (e) {
        console.warn('[Worker] Invalid JSON from Soniox:', data);
        return;
    }

    // Handle Soniox response format
    // Soniox sends: { words: [...], final_proc_time_ms, non_final_proc_time_ms }
    
    if (msg.error) {
        console.error('[Worker] Soniox error:', msg.error);
        safeSend(clientWs, JSON.stringify({ 
            type: 'error', 
            message: msg.error 
        }));
        return;
    }

    // Process words array
    if (msg.words && Array.isArray(msg.words)) {
        const result = processWords(msg.words, state);
        
        if (result.text || result.segments.length > 0) {
            state.partialCount++;
            
            // Send partial transcript to client
            safeSend(clientWs, JSON.stringify({
                type: 'partial_transcript',
                text: result.fullText,
                segments: result.segments,
                stats: {
                    partial_count: state.partialCount,
                    final_count: state.finalTranscriptParts.length
                }
            }));
        }
    }
}

/**
 * Process Soniox words array
 */
function processWords(words, state) {
    let currentSegment = {
        text: '',
        start: null,
        end: null,
        confidence: 0,
        speaker: 'speaker_1',
        isFinal: false
    };
    
    const segments = [];
    let fullText = '';
    let confidenceSum = 0;
    let wordCount = 0;

    for (const word of words) {
        const text = word.text || '';
        const isFinal = word.is_final === true;
        const startMs = word.start_ms || 0;
        const endMs = word.end_ms || startMs;
        const confidence = word.confidence || 0.9;

        if (text.trim()) {
            if (currentSegment.start === null) {
                currentSegment.start = startMs / 1000;
            }
            currentSegment.end = endMs / 1000;
            currentSegment.text += (currentSegment.text ? ' ' : '') + text;
            currentSegment.isFinal = isFinal;
            confidenceSum += confidence;
            wordCount++;

            // If this word is final, close the segment
            if (isFinal) {
                currentSegment.confidence = wordCount > 0 ? confidenceSum / wordCount : 0.9;
                segments.push({ ...currentSegment });
                
                // Add to final parts
                state.finalTranscriptParts.push(text);
                
                // Store segment
                state.segments.push({
                    start: currentSegment.start,
                    end: currentSegment.end,
                    text: currentSegment.text,
                    confidence: currentSegment.confidence,
                    speaker: currentSegment.speaker
                });

                // Reset for next segment
                currentSegment = {
                    text: '',
                    start: null,
                    end: null,
                    confidence: 0,
                    speaker: 'speaker_1',
                    isFinal: false
                };
                confidenceSum = 0;
                wordCount = 0;
            }
        }
    }

    // Include non-final text in display
    if (currentSegment.text) {
        currentSegment.confidence = wordCount > 0 ? confidenceSum / wordCount : 0.9;
        segments.push(currentSegment);
    }

    // Build full text from final parts + current interim
    fullText = state.finalTranscriptParts.join(' ');
    if (currentSegment.text) {
        fullText += (fullText ? ' ' : '') + currentSegment.text;
    }

    return { 
        text: currentSegment.text, 
        fullText,
        segments,
        isFinal: currentSegment.isFinal
    };
}

/**
 * Finalize Soniox connection and send full transcript
 */
async function finalizeSonioxAndSendResult(clientWs, state) {
    // Signal end of stream to Soniox
    if (state.sonioxWs && state.sonioxWs.readyState === WebSocket.OPEN) {
        safeSend(state.sonioxWs, JSON.stringify({ end_of_stream: true }));
        
        // Wait briefly for final responses
        await new Promise(r => setTimeout(r, 500));
    }

    // Calculate duration
    const durationMs = Date.now() - state.startTime;
    const durationS = Math.round(durationMs / 10) / 100;

    // Build final transcript
    const fullTranscript = state.finalTranscriptParts.join(' ').trim();
    
    // Consolidate segments
    const consolidatedSegments = consolidateSegments(state.segments);

    // Send full transcript to client
    const result = {
        type: 'full_transcript',
        transcript: fullTranscript,
        segments: consolidatedSegments,
        duration: durationS,
        stats: {
            partial_count: state.partialCount,
            duration_s: durationS
        }
    };

    console.log('[Worker] Sending full transcript:', {
        length: fullTranscript.length,
        segments: consolidatedSegments.length,
        duration: durationS
    });

    safeSend(clientWs, JSON.stringify(result));

    // Close connections gracefully
    closeSonioxConnection(state);
    
    // Close client connection after a brief delay
    setTimeout(() => {
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(1000, 'Processing complete');
        }
    }, 100);
}

/**
 * Consolidate overlapping segments
 */
function consolidateSegments(segments) {
    if (!segments || segments.length === 0) return [];
    
    // Sort by start time
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    
    const consolidated = [];
    let current = null;

    for (const seg of sorted) {
        if (!current) {
            current = { ...seg };
        } else if (seg.start <= current.end + 0.1) {
            // Merge overlapping segments
            current.end = Math.max(current.end, seg.end);
            current.text += ' ' + seg.text;
            current.confidence = (current.confidence + seg.confidence) / 2;
        } else {
            consolidated.push(current);
            current = { ...seg };
        }
    }

    if (current) {
        consolidated.push(current);
    }

    return consolidated;
}

/**
 * Close Soniox connection
 */
function closeSonioxConnection(state) {
    if (state.sonioxWs) {
        try {
            if (state.sonioxWs.readyState === WebSocket.OPEN || 
                state.sonioxWs.readyState === WebSocket.CONNECTING) {
                state.sonioxWs.close(1000, 'Session ended');
            }
        } catch (e) {
            // Ignore close errors
        }
        state.sonioxWs = null;
    }
}

/**
 * Safe send helper
 */
function safeSend(ws, data) {
    try {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
        }
    } catch (e) {
        console.error('[Worker] Send error:', e);
    }
}
