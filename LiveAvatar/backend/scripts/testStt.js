
import WebSocket from "ws";

const WS_URL = "ws://127.0.0.1:5050/ws/stt";
const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  console.log("WS connected:", WS_URL);
  ws.send(JSON.stringify({ type: "start", conversationId: "demo-1" }));
  setTimeout(() => ws.send(JSON.stringify({ type: "stop" })), 1500);
});

ws.on("message", (d) => console.log("WS:", d.toString()));
ws.on("error", (e) => console.error("WS ERROR:", e));
ws.on("close", () => console.log("WS closed"));
