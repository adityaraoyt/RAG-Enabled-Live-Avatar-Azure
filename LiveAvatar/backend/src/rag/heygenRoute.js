import express from "express";
import { config } from "../config.js";

export const heygenRouter = express.Router();

heygenRouter.get("/health", (req, res) => {
  res.json({ ok: true, configured: Boolean(config.heygen.apiKey) });
});
