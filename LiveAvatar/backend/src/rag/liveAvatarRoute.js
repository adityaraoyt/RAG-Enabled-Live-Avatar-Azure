import express from "express";
import WebSocket from "ws";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";

export const liveAvatarRouter = express.Router();

const LIVEAVATAR_API_KEY = process.env.LIVEAVATAR_API_KEY;
const LIVEAVATAR_BASE = process.env.LIVEAVATAR_BASE_URL || "https://api.liveavatar.com/v1";

const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION;

// session_id -> { ws, keepAliveTimer }
const sessions = new Map();

function must(name, v) {
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

async function createSession({ avatar_id }) {
  must("LIVEAVATAR_API_KEY", LIVEAVATAR_API_KEY);

  const tokenResp = await fetch(`${LIVEAVATAR_BASE}/sessions/token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "X-API-KEY": LIVEAVATAR_API_KEY,
    },
    body: JSON.stringify({ mode: "LITE", avatar_id }),
  });

  const tokenJson = await tokenResp.json();
  if (!tokenResp.ok) throw new Error(`token failed: ${JSON.stringify(tokenJson)}`);

  // ✅ unwrap data
  const sessionToken = tokenJson?.data?.session_token;
  if (!sessionToken || String(sessionToken).split(".").length !== 3) {
    throw new Error(`token missing/invalid: ${JSON.stringify(tokenJson)}`);
  }

  const startResp = await fetch(`${LIVEAVATAR_BASE}/sessions/start`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${sessionToken}`,
    },
  });

  const startJson = await startResp.json();
  if (!startResp.ok) throw new Error(`start failed: ${JSON.stringify(startJson)}`);

  // ✅ unwrap data here too
  return startJson?.data ?? startJson;
}


async function connectWs(session_id, ws_url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(ws_url);
    ws.once("error", reject);
    ws.once("open", () => {
      const keepAliveTimer = setInterval(() => {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "session.keep_alive" }));
          }
        } catch {}
      }, 30_000);

      sessions.set(session_id, { ws, keepAliveTimer });

      ws.on("close", () => {
        const s = sessions.get(session_id);
        if (s?.keepAliveTimer) clearInterval(s.keepAliveTimer);
        sessions.delete(session_id);
      });

      resolve();
    });
  });
}

// POST /api/liveavatar/session { avatar_id }
// returns: { session_id, livekit_url, livekit_token }
liveAvatarRouter.post("/session", async (req, res) => {
  try {
    const { avatar_id } = req.body || {};
    if (!avatar_id) return res.status(400).json({ error: "Missing avatar_id" });

    const start = await createSession({ avatar_id });

    // start is now the unwrapped "data" object
    const {
  session_id,
  livekit_url,
  livekit_client_token,
  ws_url,
} = start;

if (!session_id || !livekit_url || !livekit_client_token || !ws_url) {
  return res.status(500).json({
    error: "LiveAvatar response missing required fields",
    got: Object.keys(start || {}),
    start,
  });
}

await connectWs(session_id, ws_url);

return res.json({
  session_id,
  livekit_url,
  livekit_token: livekit_client_token, // normalize name for frontend
});

  } catch (e) {
    console.error("liveavatar /session error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});


// POST /api/liveavatar/speak { session_id, text, voice? }
liveAvatarRouter.post("/speak", async (req, res) => {
  try {
    must("AZURE_SPEECH_KEY", AZURE_SPEECH_KEY);
    must("AZURE_SPEECH_REGION", AZURE_SPEECH_REGION);

    const { session_id, text, voice } = req.body || {};
    const t = String(text || "").trim();

    if (!session_id) return res.status(400).json({ error: "Missing session_id" });
    if (!t) return res.status(400).json({ error: "Missing text" });

    const sess = sessions.get(session_id);
    if (!sess?.ws || sess.ws.readyState !== WebSocket.OPEN) {
      return res.status(400).json({ error: "Session websocket not connected" });
    }

    const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(
      AZURE_SPEECH_KEY,
      AZURE_SPEECH_REGION
    );
    if (voice) speechConfig.speechSynthesisVoiceName = voice;
    speechConfig.speechSynthesisOutputFormat =
      SpeechSDK.SpeechSynthesisOutputFormat.Raw24Khz16BitMonoPcm;

    const pushStream = SpeechSDK.PushAudioOutputStream.create({
      write: (chunk) => {
        const b64 = Buffer.from(chunk).toString("base64");
        sess.ws.send(JSON.stringify({ type: "agent.speak", audio: b64 }));
      },
      close: () => {
        sess.ws.send(JSON.stringify({ type: "agent.speak_end" }));
      },
    });

    const audioConfig = SpeechSDK.AudioConfig.fromStreamOutput(pushStream);
    const synthesizer = new SpeechSDK.SpeechSynthesizer(speechConfig, audioConfig);

    // Respond immediately; stream continues
    res.json({ ok: true });

    synthesizer.speakTextAsync(
      t,
      () => synthesizer.close(),
      (err) => {
        console.error("Azure TTS error:", err);
        synthesizer.close();
      }
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// POST /api/liveavatar/interrupt { session_id }
liveAvatarRouter.post("/interrupt", async (req, res) => {
  try {
    const { session_id } = req.body || {};
    if (!session_id) return res.status(400).json({ error: "Missing session_id" });

    const sess = sessions.get(session_id);
    if (!sess?.ws || sess.ws.readyState !== WebSocket.OPEN) {
      return res.status(400).json({ error: "Session websocket not connected" });
    }

    sess.ws.send(JSON.stringify({ type: "agent.interrupt" }));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});
