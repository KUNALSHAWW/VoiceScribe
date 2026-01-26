/**
 * VoiceScribe - Cloudflare Worker
 * Acts as a Real-time WebSocket Proxy between Client and Soniox
 */

export default {
    async fetch(request, env, ctx) {
        // 1. Validate the WebSocket Upgrade request
        const upgradeHeader = request.headers.get('Upgrade');
        if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
            return new Response('Expected Upgrade: websocket', { status: 426 });
        }

        // 2. Create a pair of WebSockets (one for client, one for server)
        const [client, server] = Object.values(new WebSocketPair());
        
        // 3. Keep the worker alive until the session ends
        ctx.waitUntil(handleSession(server, env));

        // 4. Return the client connection immediately
        return new Response(null, { status: 101, webSocket: client });
    },
};

async function handleSession(clientWs, env) {
    clientWs.accept();
    console.log('[Server] Client Connected.');

    // Validate API Key
    if (!env.SONIOX_API_KEY) {
        console.error('[Server] FATAL: SONIOX_API_KEY is missing in .dev.vars');
        clientWs.close(1011, "Server Config Error");
        return;
    }

    // Connect to Soniox Standard API
    const sonioxWs = new WebSocket('wss://api.soniox.com/transcribe-websocket');
    let isStopped = false;

    // --- SAFE SEND HELPERS (Prevents Crashes) ---
    const safeSendClient = (msg) => {
        try { 
            // FIX: Used WebSocket.OPEN (1) instead of undefined READY_STATE_OPEN
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(msg); 
        } catch (e) { /* Ignore dropped packets on close */ }
    };

    const safeSendSoniox = (msg) => {
        try { 
            if (sonioxWs.readyState === WebSocket.OPEN) sonioxWs.send(msg); 
        } catch (e) { /* Ignore dropped packets on close */ }
    };

    // --- SONIOX HANDLERS ---
    
    sonioxWs.addEventListener('open', () => {
        console.log('[Server] Connected to Soniox. Sending config...');
        const config = {
            api_key: env.SONIOX_API_KEY,
            model: 'en_v2', 
            audio_format: 'webm_opus', 
            sample_rate_hertz: 16000,
            num_audio_channels: 1,
            include_nonfinal: true
        };
        safeSendSoniox(JSON.stringify(config));
    });

    sonioxWs.addEventListener('message', (event) => {
        // Real-time: Forward transcript partials immediately to client
        safeSendClient(event.data);
    });

    sonioxWs.addEventListener('close', (e) => {
        console.log(`[Server] Soniox Closed. Code: ${e.code}, Reason: ${e.reason || 'None'}`);
        
        const reason = e.reason || "";
        
        // ERROR HANDLING: If closure was due to an error (like balance exhausted)
        if (reason.toLowerCase().includes("exhausted") || reason.toLowerCase().includes("error") || e.code !== 1000) {
            console.error(`[Server] Detected Upstream Error: ${reason}`);
            
            // Send the specific error to the client so the UI can show it
            safeSendClient(JSON.stringify({ 
                type: 'error', 
                message: `Transcription failed: ${reason || "Connection rejected"}` 
            }));
        }

        // Close the client side safely
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(1000, "Processing Complete");
        }
    });

    sonioxWs.addEventListener('error', (e) => {
        console.error('[Server] Soniox Error:', e);
    });

    // --- CLIENT HANDLERS ---

    clientWs.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') {
            // BINARY AUDIO CHUNK -> Stream to Soniox
            safeSendSoniox(event.data);
        } else {
            // JSON CONTROL MESSAGE
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'stop') {
                    isStopped = true;
                    console.log('[Server] Stop received from client.');
                    // Tell Soniox we are done so it processes the final bits
                    safeSendSoniox(JSON.stringify({ end_of_stream: true }));
                }
            } catch (e) {
                console.warn('[Server] Invalid JSON from client');
            }
        }
    });

    clientWs.addEventListener('close', () => {
        console.log('[Server] Client Disconnected.');
        if (sonioxWs.readyState === WebSocket.OPEN) sonioxWs.close();
    });

    // KEEP ALIVE: Wait here until one side closes connection
    await new Promise(resolve => {
        clientWs.addEventListener('close', resolve);
        sonioxWs.addEventListener('close', resolve);
    });
}