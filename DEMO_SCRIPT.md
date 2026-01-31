# VoiceScribe Demo Script

## Video Demo (90-120 seconds)

### Opening Shot (0-10s)
**[Screen: VoiceScribe UI - idle state]**

> "Hi, I'm demonstrating VoiceScribe - a real-time speech transcription system built with AudioWorklet, Cloudflare Workers, and Soniox."

### Architecture Overview (10-25s)
**[Screen: Architecture diagram or code split view]**

> "The browser captures raw PCM audio at 16kHz using AudioWorklet. This streams through a Cloudflare Worker to Soniox's speech API. The worker aggregates results and sends both incremental updates AND a final consolidated transcript."

### Live Demo - Start Recording (25-45s)
**[Screen: Click record button, visualizer animates]**

> "Watch the audio visualizer respond in real-time as I speak. The client is capturing raw PCM, downsampling to 16kHz, and streaming binary frames over WebSocket."

### Live Partial Transcripts (45-70s)
**[Screen: Show transcript area updating in real-time]**

> "Notice how partial transcripts appear instantly as I speak. The interim text in gray updates continuously - this is Soniox's streaming recognition. Final words become white text."

### Stop Recording - Full Transcript (70-90s)
**[Screen: Click stop, show final JSON response]**

> "When I stop recording, the worker sends a single consolidated full_transcript message. It includes the complete text, timestamped segments with confidence scores, total duration, and statistics like partial count."

### Key Technical Points (90-110s)
**[Screen: Code highlights or bullet points]**

> "Key highlights:
> - AudioWorklet for low-latency capture with ScriptProcessor fallback
> - Binary PCM streaming - no codec overhead
> - Worker handles all Soniox communication - API key never exposed
> - Robust reconnection with exponential backoff
> - Black and white glossy UI - minimal dependencies"

### Closing (110-120s)
**[Screen: Final transcript visible]**

> "VoiceScribe demonstrates production-ready real-time transcription. Check the README for deployment instructions."

---

## 30-Second Highlight Clip

### Quick Cut Version

**[0-5s]** VoiceScribe logo/title

**[5-12s]** Split screen: User speaking → Transcript appearing in real-time

**[12-20s]** Click STOP → Full JSON transcript with segments, timestamps, confidence scores

**[20-28s]** Code highlight: "AudioWorklet PCM → Worker → Soniox → partial_transcript → full_transcript"

**[28-30s]** "Production-ready real-time transcription"

---

## Key Talking Points

1. **AudioWorklet vs MediaRecorder**: Raw PCM gives us complete control over audio format - no codec negotiation issues
2. **Why 16kHz?**: Speech recognition sweet spot - sufficient quality, minimal bandwidth
3. **Worker as Proxy**: Security (API key protected) + aggregation (full_transcript consolidation)
4. **Partial vs Final**: Users see progress; apps get structured data
5. **Bandwidth tradeoff**: 32KB/s vs 6KB/s for Opus, but no decode latency

---

## Demo Checklist

- [ ] Worker running locally (`cd worker && npm run dev`)
- [ ] Client served (`cd client && npx serve .`)
- [ ] Microphone permissions granted
- [ ] Good internet connection (for Soniox API)
- [ ] Browser dev console open to show messages
- [ ] Screen recording software ready
