
// backend/src/ws/sttws.js
import { WebSocketServer } from "ws";
import sdk from "microsoft-cognitiveservices-speech-sdk";

export default function attachSttWebSocket(httpServer, { path = "/ws/stt" } = {}) {
  const wss = new WebSocketServer({ server: httpServer, path });

  wss.on("connection", (ws, req) => {
    console.log("WS connected from", req.socket?.remoteAddress);

    let conversationId = null;
    let startedAt = Date.now();
    let isRecording = false;
    let totalBytes = 0;

    let pushStream = null;
    let recognizer = null;

    const send = (obj) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
    };

    const startRecognizer = () => {
      if (isRecording) return;
      isRecording = true;
      startedAt = Date.now();
      totalBytes = 0;

      // Explicit stream format: PCM 16kHz, 16-bit, mono
      const format = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
      pushStream = sdk.AudioInputStream.createPushStream(format);
      const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

      const speechConfig = sdk.SpeechConfig.fromSubscription(
        process.env.AZURE_SPEECH_KEY,
        process.env.AZURE_SPEECH_REGION
      );
      speechConfig.speechRecognitionLanguage = "en-US";

      recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

      // Lifecycle + errors
      recognizer.sessionStarted = (_s, e) => {
        console.log(`[ASR] sessionStarted: ${e.sessionId}`);
        send({ type: "meta", event: "sessionStarted", sessionId: e.sessionId });
      };
      recognizer.sessionStopped = (_s, e) => {
        console.log(`[ASR] sessionStopped: ${e.sessionId}`);
        send({ type: "meta", event: "sessionStopped", sessionId: e.sessionId });
      };
      recognizer.canceled = (_s, e) => {
        console.warn("[ASR] canceled:", e.reason, e.errorDetails || "");
        send({ type: "error", reason: e.reason, error: e.errorDetails });
      };

      recognizer.recognizing = (_s, e) => {
        const t = e?.result?.text;
        if (t && t.trim()) send({ type: "partial", conversationId, text: t });
      };
      recognizer.recognized = (_s, e) => {
        const t = e?.result?.text;
        if (t && t.trim()) {
          console.log("[ASR] final:", t);
          send({ type: "final", conversationId, text: t });
        }
      };

      recognizer.startContinuousRecognitionAsync(
        () => console.log("[ASR] startContinuousRecognitionAsync: OK"),
        (err) => {
          console.error("[ASR] startContinuousRecognitionAsync: ERR", err);
          send({ type: "error", error: String(err?.message || err) });
        }
      );

      send({ type: "started", conversationId });
    };

    // Initial ready
    send({ type: "ready" });

    ws.on("message", async (data) => {
      // Control messages
      if (typeof data === "string") {
        let msg;
        try { msg = JSON.parse(data); } catch {
          console.warn("[CTRL] invalid JSON:", data);
          send({ type: "error", error: "Invalid JSON message" });
          return;
        }

        console.log("[CTRL] msg:", msg);

        if (msg.type === "start") {
          conversationId = msg.conversationId || null;
          startRecognizer();
          return;
        }

        if (msg.type === "stop") {
          if (isRecording) {
            isRecording = false;
            recognizer?.stopContinuousRecognitionAsync(
              () => {
                console.log("[ASR] stopped");
                recognizer?.close();
                recognizer = null;
              },
              (err) => console.error("[ASR] stop error:", err)
            );
            pushStream?.close();
            pushStream = null;
          }

          send({
            type: "done",
            conversationId,
            durationMs: Date.now() - startedAt,
            totalBytes,
          });
          return;
        }

        if (msg.type === "ping") {
          send({ type: "pong" });
          return;
        }

        return;
      }

      // Binary audio chunks (browser sends ArrayBuffer; Node 'ws' gives Buffer)
      if (data instanceof Buffer) {
        // ✅ If no 'start' was received (StrictMode, race), auto-start now
        if (!isRecording) {
          console.log("[AUDIO] first chunk -> auto-start recognizer");
          startRecognizer();
        }

        totalBytes += data.length;
        if (totalBytes < 5 * 8192) {
          console.log("[AUDIO] chunk received:", data.length, "bytes (total:", totalBytes, ")");
        }

        pushStream?.write(data);
        return;
      }

      // Unknown frame type
      console.warn("[WS] unknown frame:", typeof data);
    });

    ws.on("close", () => {
      console.log("WS closed");
      recognizer?.stopContinuousRecognitionAsync();
      pushStream?.close();
    });

    ws.on("error", (err) => {
      console.error("WS socket error:", err);
      send({ type: "error", error: String(err?.message || err) });
    });
  });

  return wss;
}
