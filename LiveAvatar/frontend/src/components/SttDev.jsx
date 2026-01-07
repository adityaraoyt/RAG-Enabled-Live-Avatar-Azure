
import { useEffect, useRef, useState } from "react";

export default function SttDev() {
  const wsRef = useRef(null);
  const connectOnceRef = useRef(false);  // ensures we only connect once in StrictMode
  const cleanupRanRef = useRef(false);    // prevents double cleanup
  const mediaRef = useRef(null);
  const audioCtxRef = useRef(null);
  const [log, setLog] = useState([]);

  useEffect(() => {
    if (connectOnceRef.current) return;   // already connected (StrictMode safe)
    connectWS();
    connectOnceRef.current = true;

    return () => {
      if (cleanupRanRef.current) return;
      cleanupRanRef.current = true;

      // Stop mic regardless
      stopMic();

      // Only stop WS if it's OPEN; don't close CONNECTING sockets
      try {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "stop" }));
          ws.close();
        }
      } catch {}
    };
  }, []);

  function append(m) {
    setLog((prev) => [...prev, m].slice(-200));
  }

  function connectWS() {
    const ws = new WebSocket("ws://127.0.0.1:5050/ws/stt"); // use wss:// if your frontend is https
    wsRef.current = ws;

    ws.onopen = async () => {
      append({ type: "client", text: "WS open" });
      // Start session only now, after OPEN
      ws.send(JSON.stringify({ type: "start", conversationId: "browser-test-1" }));
      try { await startMic(ws); }
      catch (err) {
        append({ type: "error", text: `Mic error: ${String(err?.message || err)}` });
      }
    };

    
ws.onmessage = (ev) => {
  try {
    const msg = JSON.parse(ev.data);
    console.log("[SERVER]", msg);
    append(msg);
  } catch {
    append({ type: "server_raw", text: String(ev.data) });
  }
};


    ws.onerror = (ev) => {
      append({ type: "ws_error", text: "WebSocket error (see console)" });
      console.error("WS error event:", ev);
    };

    ws.onclose = (ev) => {
      append({ type: "client", text: `WS closed (code=${ev.code}, reason=${ev.reason || ""})` });
    };
  }

  async function startMic(ws) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRef.current = stream;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    audioCtxRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(audioCtx.destination);

    
processor.onaudioprocess = (e) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const input = e.inputBuffer.getChannelData(0);
  if (!input || !input.length) return;

 if (Math.random() < 0.01) {
  console.log("[MIC] float32 samples:", input.slice(0,5));
}

// Float32 -> Int16 PCM (little-endian), then send ArrayBuffer
const pcm = new Int16Array(input.length);
for (let i = 0; i < input.length; i++) {
  const s = Math.max(-1, Math.min(1, input[i]));
  pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
}
ws.send(pcm.buffer);

};



  }

  function stopMic() {
    try { mediaRef.current?.getTracks()?.forEach((t) => t.stop()); } catch {}
    try { audioCtxRef.current?.close(); } catch {}
  }

  return (
    <div style={{ padding: 16 }}>
      <h3>STT Dev</h3>
      <div style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", marginTop: 12 }}>
        {log.map((m, i) => <div key={i}>{JSON.stringify(m)}</div>)}
      </div>
    </div>
  );
}
