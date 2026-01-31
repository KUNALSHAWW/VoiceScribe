/**
 * PCM AudioWorklet Processor
 * Captures raw Float32 PCM samples and sends to main thread
 * Buffering reduces message frequency for efficiency
 */
class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 2048;
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input.length) return true;
        
        const channelData = input[0];
        if (!channelData || !channelData.length) return true;
        
        // Copy samples to buffer
        for (let i = 0; i < channelData.length; i++) {
            this.buffer[this.bufferIndex++] = channelData[i];
            
            if (this.bufferIndex >= this.bufferSize) {
                // Send buffer to main thread
                this.port.postMessage(new Float32Array(this.buffer));
                this.bufferIndex = 0;
            }
        }
        
        return true;
    }
}

registerProcessor('pcm-processor', PCMProcessor);
