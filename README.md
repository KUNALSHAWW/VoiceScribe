<div align="center">

# 🎙️ VoiceScribe

### Real-time Speech-to-Text Transcription Platform

[![Status](https://img.shields.io/badge/Status-Production%20Ready-success?style=for-the-badge)](https://github.com/KUNALSHAWW/VoiceScribe)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers-orange?style=for-the-badge&logo=cloudflare)](https://workers.cloudflare.com/)
[![Soniox](https://img.shields.io/badge/Powered%20by-Soniox%20AI-violet?style=for-the-badge)](https://soniox.com/)

*Transform your voice into text instantly with enterprise-grade accuracy*

</div>

---

## 🌟 Overview

**VoiceScribe** is a production-ready, real-time speech transcription application using:
- **AudioWorklet** for raw PCM audio capture in the browser
- **Cloudflare Workers** as an edge proxy to Soniox
- **Soniox Speech API** for high-accuracy transcription

### Key Features

- ⚡ **Low Latency** - Raw PCM streaming with AudioWorklet (~50ms buffer)
- 🎯 **High Accuracy** - Soniox's state-of-the-art speech recognition
- 🎨 **Elegant UI** - Black/white glossy radiant theme
- 🔒 **Secure** - API keys never exposed to client
- 📱 **Cross-Browser** - AudioWorklet with ScriptProcessor fallback

---

## 🏗️ Architecture

```
┌─────────────┐     WebSocket      ┌──────────────────┐     WebSocket      ┌─────────────┐
│   Browser   │ ──────────────────▶│ Cloudflare Worker│ ──────────────────▶│   Soniox    │
│ (AudioWorklet)                   │  (Edge Proxy)    │                    │  Speech API │
│             │ ◀──────────────────│                  │ ◀──────────────────│             │
│  PCM 16kHz  │  partial_transcript│  Forward PCM     │   Transcription    │             │
│   Int16     │  full_transcript   │  Aggregate final │     Results        │             │
└─────────────┘                    └──────────────────┘                    └─────────────┘
```

### Data Flow

1. **Audio Capture** - Browser captures microphone via AudioWorklet (or ScriptProcessor fallback)
2. **Client Processing** - Downsample to 16kHz, convert Float32 to Int16 PCM
3. **WebSocket Streaming** - Binary PCM frames sent to Cloudflare Worker
4. **Edge Proxy** - Worker forwards PCM to Soniox, relays transcripts to client
5. **Aggregation** - Worker aggregates final segments, sends consolidated transcript on stop

### WebSocket Protocol

**Client → Worker:**
```javascript
// Start session
{ "type": "start", "session_id": "uuid" }

// Binary PCM frames (16kHz, 16-bit, mono)
ArrayBuffer

// Stop recording
{ "type": "finalize" }
```

**Worker → Client:**
```javascript
// Partial transcript (incremental)
{ 
  "type": "partial_transcript",
  "text": "Hello world...",
  "segments": [...],
  "stats": { "partial_count": 5 }
}

// Full transcript (on finalize)
{
  "type": "full_transcript",
  "transcript": "Full transcribed text...",
  "segments": [
    { "start": 0.12, "end": 1.74, "text": "...", "confidence": 0.92, "speaker": "speaker_1" }
  ],
  "duration": 12.34,
  "stats": { "partial_count": 7, "duration_s": 12.34 }
}
```

---

## 📁 Project Structure

```
VoiceScribe/
├── client/                      # Frontend Application
│   ├── index.html              # Main HTML
│   ├── style.css               # Black/white glossy theme
│   ├── app.js                  # AudioWorklet client logic
│   └── pcm-worklet.js          # AudioWorkletProcessor
│
├── worker/                      # Cloudflare Edge Worker
│   ├── src/index.js            # WebSocket proxy to Soniox
│   ├── wrangler.toml           # Worker configuration
│   └── .dev.vars               # Local secrets (gitignored)
│
├── test/                        # Integration Tests
│   ├── test_integration.js     # Main test runner
│   ├── fixtures/               # Test audio files
│   └── mocks/                  # Soniox mock server
│
├── .env.example                 # Environment template
└── README.md                    # This file
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Cloudflare account (free tier works)
- Soniox API key ([get one here](https://console.soniox.com))

### 1. Clone & Install

```bash
git clone https://github.com/yourname/voicescribe.git
cd voicescribe

# Install worker dependencies
cd worker && npm install && cd ..

# Install test dependencies (optional)
npm install ws
```

### 2. Configure Secrets

```bash
# For local development
echo "SONIOX_API_KEY=your_api_key" > worker/.dev.vars

# For production (run from worker directory)
cd worker
npx wrangler secret put SONIOX_API_KEY
```

### 3. Run Locally

```bash
# Terminal 1: Start worker
cd worker
npm run dev
# Worker runs at http://localhost:8787

# Terminal 2: Serve client (any static server)
cd client
npx serve .
# Or: python -m http.server 8080
```

### 4. Open in Browser

Navigate to `http://localhost:8080` (or wherever you served the client).

---

## 🧪 Testing

### Run Integration Tests

```bash
# Make sure worker is running first
cd worker && npm run dev &

# Run tests
node test/test_integration.js
```

### Test with Mock Server

```bash
# Start Soniox mock
node test/mocks/soniox-mock.js &

# Run tests (modify WORKER_URL if needed)
node test/test_integration.js
```

### Expected Output

```
============================================================
VoiceScribe Integration Tests
============================================================
Worker URL: ws://localhost:8787/ws
Test Fixture: test/fixtures/sample-16k-mono.pcm

[Test] Running: WebSocket Connection
[Test] ✓ PASSED: WebSocket Connection

[Test] Running: Start Message Handling
[Test] ✓ PASSED: Start Message Handling

[Test] Running: Full Transcription Flow
[Test] Connected, streaming PCM...
[Test] Sending finalize...
[Test] Received full transcript
[Test] ✓ PASSED: Full Transcription Flow

============================================================
Test Summary
============================================================
Passed: 4
Failed: 0
============================================================
```

---

## 🚢 Deployment

### Deploy Worker to Cloudflare

```bash
cd worker

# Login to Cloudflare
npx wrangler login

# Set API key secret
npx wrangler secret put SONIOX_API_KEY

# Deploy
npx wrangler deploy
```

### Deploy Client

Host the `client/` folder on any static hosting:
- Cloudflare Pages
- Vercel
- Netlify
- GitHub Pages

Update `getWorkerUrl()` in `app.js` to point to your deployed worker.

---

## ⚠️ Important Notes

### Bandwidth Considerations
- Raw PCM at 16kHz mono 16-bit = **32 KB/s** (vs ~6 KB/s for Opus)
- Total for 1 minute = ~2 MB upload
- Consider this for mobile users on metered connections

### Browser Support
- **AudioWorklet**: Chrome 66+, Firefox 76+, Safari 14.1+, Edge 79+
- **Fallback**: ScriptProcessorNode for older browsers (deprecated but functional)

### Soniox Pricing
- Soniox charges per audio minute
- Check current pricing at [soniox.com/pricing](https://soniox.com/pricing)
- For high-volume usage, contact Soniox for enterprise pricing

### Security
- Never expose `SONIOX_API_KEY` in client code
- Worker acts as secure proxy
- All audio data in transit is encrypted (WSS)

---

## 🔧 Configuration

### Worker Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SONIOX_API_KEY` | Yes | Your Soniox API key |

### Client Configuration

Edit `app.js` to customize:
- `targetSampleRate`: Default 16000 Hz
- `maxReconnectAttempts`: Default 5
- `getWorkerUrl()`: Worker endpoint

---

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- [Soniox](https://soniox.com) - Speech recognition API
- [Cloudflare Workers](https://workers.cloudflare.com) - Edge computing platform
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) - Browser audio processing
