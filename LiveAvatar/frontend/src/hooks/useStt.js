
// src/hooks/useStt.js
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Simple STT hook: microphone -> WS -> partial/final callbacks.
 * - Sends {type:"start", conversationId} on open
 * - Streams Int16 PCM as ArrayBuffer
 * - Calls onFinal(text) for each finalized utterance
 * - StrictMode-safe via connectOnce guard
 */
export function useStt({
  wsUrl = "ws://127.0.0.1:5050/ws/stt",   // if your frontend runs on HTTPS, use wss://
  conversationId,
  onPartial,                              // optional live caption
  onFinal,                                // REQUIRED: called with final transcript
  onError,                                // optional error reporter
}) {
  const wsRef = useRef(null);
  const mediaRef = useRef(null);
  const audioCtxRef = useRef(null);
  const connectOnceRef = useRef(false);

  const [isMicOn, setIsMicOn] = useState(false);

  const cleanup = useCallback(() => {
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "stop" }));
      }
    } catch {}
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
    connectOnceRef.current = false;

    try { mediaRef.current?.getTracks()?.forEach((t) => t.stop()); } catch {}
    try { audioCtxRef.current?.close(); } catch {}
    mediaRef.current = null;
    audioCtxRef.current = null;

    setIsMicOn(false);
    onPartial?.("");
  }, [onPartial]);

  const startMic = useCallback(async (ws) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRef.current = stream;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(audioCtx.destination);

    processor.onaudioprocess = (e) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      if (!input || !input.length) return;

      // Float32 [-1..1] -> Int16 PCM (little-endian)
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      ws.send(pcm.buffer); // ArrayBuffer
    };
  }, []);

  const connect = useCallback(() => {
    if (connectOnceRef.current && wsRef.current) return;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    connectOnceRef.current = true;

    ws.onopen = async () => {
      ws.send(JSON.stringify({ type: "start", conversationId }));
      try {
        await startMic(ws);
        setIsMicOn(true);
      } catch (err) {
        setIsMicOn(false);
        onError?.({ type: "mic_error", error: String(err?.message || err) });
      }
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { msg = { type: "server_raw", text: String(ev.data) }; }
      if (msg.type === "partial") onPartial?.(msg.text || "");
      else if (msg.type === "final") {
        onPartial?.("");
        onFinal?.(msg.text || "");
      } else if (msg.type === "error") {
        onError?.({ type: "stt_error", ...msg });
      }
    };

    ws.onerror = (e) => onError?.({ type: "ws_error", error: String(e?.message || e) });
    ws.onclose = () => { setIsMicOn(false); onPartial?.(""); };
  }, [conversationId, wsUrl, startMic, onPartial, onFinal, onError]);

  const disconnect = useCallback(() => cleanup(), [cleanup]);
  const toggle = useCallback(() => (isMicOn ? disconnect() : connect()), [isMicOn, connect, disconnect]);

  // cleanup on unmount

useEffect(() => {
 return () => cleanup();
}, []);


  return { isMicOn, toggle, connect, disconnect };
}
