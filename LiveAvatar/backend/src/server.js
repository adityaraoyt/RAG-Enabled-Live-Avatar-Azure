import dotenv from "dotenv";
dotenv.config();

import http from "http";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { ragRouter } from "./rag/ragRoute.js";
import { trainerRouter } from "./rag/trainerRoute.js";
import { trainerStreamRouter } from "./rag/trainerStreamRoute.js";
import { azureSpeechRouter } from "./rag/azureSpeechRoute.js";
import { liveAvatarRouter } from "./rag/liveAvatarRoute.js"; // ✅ ADD

const app = express();
const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim());

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      return cb(null, corsOrigins.includes(origin));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "2mb" }));

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/api/rag", ragRouter);
app.use("/api/trainer", trainerRouter);
app.use("/api/trainer", trainerStreamRouter);

app.use("/api/azure", azureSpeechRouter);
app.use("/api/liveavatar", liveAvatarRouter); // ✅ ADD

const server = http.createServer(app);
const port = Number(process.env.PORT || config.port || 5050);

server.listen(port, () => {
  console.log(`✅ Backend running on port ${port}`);
  console.log(`🔑 Azure token: /api/azure/speech-token`);
  console.log(`🧑‍🎤 LiveAvatar session: /api/liveavatar/session`);
  console.log(`🗣️  LiveAvatar speak: /api/liveavatar/speak`);
  console.log(`✋ LiveAvatar interrupt: /api/liveavatar/interrupt`);
});
