import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { ragRouter } from "./rag/ragRoute.js";
import { trainerRouter } from "./rag/trainerRoute.js";
import { trainerStreamRouter } from "./rag/trainerStreamRoute.js";

const app = express();
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/api/rag", ragRouter);
app.use("/api/trainer", trainerRouter);
app.use("/api/trainer", trainerStreamRouter);

app.listen(config.port, () => {
  console.log(`✅ Backend running: http://localhost:${config.port}`);
});
