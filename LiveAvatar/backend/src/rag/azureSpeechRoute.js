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

// Speech token for browser Speech SDK (STT)
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
