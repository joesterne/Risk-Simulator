import { useState, useRef, useCallback, useEffect } from 'react';

// Encode mono f32 to base64
function pcmToBase64(pcmData: Float32Array): string {
  const buffer = new ArrayBuffer(pcmData.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < pcmData.length; i++) {
    // scale to 16 bit
    const s = Math.max(-1, Math.min(1, pcmData[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function useLiveVoice() {
  const [isActive, setIsActive] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const outAudioCtxRef = useRef<AudioContext | null>(null);
  const inAudioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const nextStartTimeRef = useRef<number>(0);

  const playAudioChunk = useCallback((outCtx: AudioContext, base64Audio: string) => {
    const binaryStr = atob(base64Audio);
    const audioData = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      audioData[i] = binaryStr.charCodeAt(i);
    }
    
    // Decoding raw 16-bit PCM little endian at 24kHz is what we receive
    const outBuffer = new Int16Array(audioData.buffer);
    const audioBuffer = outCtx.createBuffer(1, outBuffer.length, 24000);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < outBuffer.length; i++) {
      channelData[i] = outBuffer[i] / 32768; // scale back to f32
    }
    
    const source = outCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outCtx.destination);
    
    const currTime = outCtx.currentTime;
    if (nextStartTimeRef.current < currTime) {
      nextStartTimeRef.current = currTime;
    }
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += audioBuffer.duration;
  }, []);

  const stopVoice = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    if (inAudioCtxRef.current) {
      inAudioCtxRef.current.close();
    }
    if (outAudioCtxRef.current) {
      outAudioCtxRef.current.close();
    }
    setIsActive(false);
  }, []);

  const startVoice = useCallback(async () => {
    if (isActive) {
       stopVoice();
       return;
    }

    try {
      const wsUrl = `ws://${window.location.host}/live`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const outCtx = new window.AudioContext({ sampleRate: 24000 });
      outAudioCtxRef.current = outCtx;
      
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.error) {
          alert(msg.error);
          stopVoice();
          return;
        }
        if (msg.audio) {
          playAudioChunk(outCtx, msg.audio);
        }
        if (msg.interrupted) {
          nextStartTimeRef.current = outCtx.currentTime; // Skip remaining queue
        }
      };

      ws.onclose = () => stopVoice();

      const inCtx = new window.AudioContext({ sampleRate: 16000 });
      inAudioCtxRef.current = inCtx;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const source = inCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      
      const processor = inCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      
      source.connect(processor);
      processor.connect(inCtx.destination);
      
      processor.onaudioprocess = (e) => {
        if (ws.readyState === WebSocket.OPEN) {
          const base64 = pcmToBase64(e.inputBuffer.getChannelData(0));
          ws.send(JSON.stringify({ audio: base64 }));
        }
      };

      setIsActive(true);
    } catch (err) {
      console.error('Microphone error:', err);
      alert('Could not access microphone');
      stopVoice();
    }
  }, [isActive, stopVoice, playAudioChunk]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopVoice();
    };
  }, [stopVoice]);

  return { isActive, startVoice, stopVoice };
}
