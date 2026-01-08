import express from "express";

export const azureSpeechRouter = express.Router();

const SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const SPEECH_REGION = process.env.AZURE_SPEECH_REGION;

function assertEnv(res) {
  if (!SPEECH_KEY || !SPEECH_REGION) {
    res.status(500).json({
      error: "Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION in backend/.env",
    });
    return false;
  }
  return true;
}

// Speech token for browser Speech SDK (STT/TTS)
azureSpeechRouter.get("/speech-token", async (req, res) => {
  if (!assertEnv(res)) return;

  try {
    const r = await fetch(
      `https://${SPEECH_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
      {
        method: "POST",
        headers: { "Ocp-Apim-Subscription-Key": SPEECH_KEY },
      }
    );

    const text = await r.text();
    if (!r.ok) return res.status(500).json({ error: text });

    res.json({ token: text, region: SPEECH_REGION });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ICE / relay token for WebRTC Avatar
azureSpeechRouter.get("/ice", async (req, res) => {
  if (!assertEnv(res)) return;

  try {
    const r = await fetch(
      `https://${SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`,
      {
        method: "GET",
        headers: { "Ocp-Apim-Subscription-Key": SPEECH_KEY },
      }
    );

    // Azure should return JSON like { Urls: [...], Username: "...", Password: "..." }
    const data = await r.json().catch(async () => ({ raw: await r.text() }));

    // If Azure doesn't return relay URLs, fail loudly with details
    if (!r.ok || !Array.isArray(data?.Urls) || data.Urls.length === 0) {
      return res.status(500).json({
        error:
          "Avatar relay token not returned (Urls missing). Check Speech resource region supports avatar + key/region match.",
        status: r.status,
        data,
      });
    }

    // Normalize to RTCIceServer[]
    res.json({
      iceServers: [
        {
          urls: data.Urls,
          username: data.Username,
          credential: data.Password,
        },
      ],
      raw: data,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
