import express from "express";
import { config } from "../config.js";

export const heygenRouter = express.Router();

// Keep this for later (don’t expose API key to frontend)
heygenRouter.get("/health", (req, res) => {
  res.json({ ok: true, configured: Boolean(config.heygen.apiKey) });
});
