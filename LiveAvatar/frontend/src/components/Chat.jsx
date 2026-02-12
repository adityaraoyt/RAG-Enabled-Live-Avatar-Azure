import { useEffect, useRef, useState } from "react";
import { streamTrainerResponse } from "../api";
import { useAzureStt } from "../hooks/useAzureStt.js";
//import { useAzureAvatar } from "../hooks/useAzureAvatar.js";
import { useLiveAvatar } from "../hooks/useLiveAvatar.js";

function newConversationId() {
  return (crypto?.randomUUID?.() ?? `conv_${Date.now()}_${Math.random()}`).toString();
}

export default function Chat() {
  const [conversationId, setConversationId] = useState(() => newConversationId());
  const [messages, setMessages] = useState([
    {
      id: "sys",
      role: "assistant",
      content: "Hey — ask me a training question and I’ll answer using your knowledge base.",
    },
  ]);
  const [input, setInput] = useState("");
  const [topK, setTopK] = useState(8);
  const [isStreaming, setIsStreaming] = useState(false);

  const abortRef = useRef(null);
  const bottomRef = useRef(null);

  // Avatar
  const videoRef = useRef(null);
  const avatar = useLiveAvatar({
   videoRef,
   avatar_id: import.meta.env.VITE_LIVEAVATAR_AVATAR_ID,
   voice: "en-US-DavisNeural",
 });
   
  // Used to speak the full response after streaming finishes
  const assistantTextRef = useRef("");

  const canSend = input.trim().length > 0 && !isStreaming;

  // Scroll to bottom as messages stream in
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  // Helper: unlock audio (must be triggered by a user gesture)
  const unlockAvatarAudio = async () => {
    try {
      const v = videoRef.current;
      if (!v) return;
      v.muted = false;
      v.volume = 1.0;
      await v.play(); // user gesture unlock
      console.log("[AVATAR] audio unlocked", { muted: v.muted, volume: v.volume });
    } catch (e) {
      console.warn("[AVATAR] play blocked:", e);
    }
  };

  // Optional: do NOT auto-connect on mount anymore.
  // The Connect Avatar button will both connect and unlock audio reliably.
  // If you want to keep auto-connect, you can, but audio may still require a gesture.
  // useEffect(() => {
  //   avatar.connect();
  //   return () => avatar.disconnect();
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, []);

  const stop = () => {
    abortRef.current?.abort?.();
    abortRef.current = null;
    setIsStreaming(false);
    avatar.stopSpeaking();
  };

  const startNewChat = () => {
    stop(); // abort streaming + stop avatar
    stt.disconnect(); // stop mic if on

    setConversationId(newConversationId());
    setMessages([{ id: "sys", role: "assistant", content: "New chat started. Ask your next question." }]);
  };

  const sendQuestion = async (question) => {
    const q = String(question || "").trim();
    if (!q) return;

    // barge-in: stop avatar speech if user asks a new question
    avatar.stopSpeaking();

    setInput("");

    const userMsgId = `u_${Date.now()}`;
    const assistantMsgId = `a_${Date.now()}`;

    // reset spoken buffer
    assistantTextRef.current = "";

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: q },
      { id: assistantMsgId, role: "assistant", content: "" },
    ]);

    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamTrainerResponse({
        conversationId,
        question: q,
        topK,
        signal: controller.signal,
        onMeta: () => {},
        onToken: (token) => {
          assistantTextRef.current += token;

          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, content: (m.content || "") + token } : m))
          );
        },
        onDone: async () => {
          setIsStreaming(false);
          abortRef.current = null;

          // speak once per assistant answer (v1)
          if (assistantTextRef.current.trim()) {
            avatar.speak(assistantTextRef.current);
          }
        },
        onError: (payload) => {
          setIsStreaming(false);
          abortRef.current = null;

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: (m.content || "") + `\n\n[Error] ${payload?.error || "Unknown error"}`,
                  }
                : m
            )
          );
        },
      });
    } catch (e) {
      setIsStreaming(false);
      abortRef.current = null;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? { ...m, content: `[Error] ${String(e?.message || e)}` } : m
        )
      );
    }
  };

  const send = async () => sendQuestion(input);

  // Azure STT (browser mic -> Azure Speech -> final text -> sendQuestion)
  const stt = useAzureStt({
    onPartial: () => {},
    onFinal: (text) => {
      // only send if we’re not already streaming an answer
      if (text && !isStreaming) sendQuestion(text);
    },
    onError: (err) => console.warn("Azure STT error:", err),
  });

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) send();
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.title}>Trainer Chat (streaming)</div>
          <div style={styles.sub}>
            conversationId: <code>{conversationId}</code>
          </div>
        </div>

        <div style={styles.controls}>
          <label style={styles.label}>
            topK&nbsp;
            <input
              type="number"
              min={1}
              max={20}
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              style={styles.num}
              disabled={isStreaming}
            />
          </label>

          {!isStreaming ? (
            <button onClick={startNewChat} style={styles.btn}>
              New chat
            </button>
          ) : (
            <button onClick={stop} style={{ ...styles.btn, ...styles.btnDanger }}>
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Avatar panel */}
      <div style={styles.avatarBar}>
        <div style={styles.avatarLeft}>
          <div style={styles.avatarStatus}>
            Avatar: <b>{avatar.status}</b>
            {avatar.lastError ? <span style={styles.avatarError}> — {avatar.lastError}</span> : null}
          </div>

          {/* Keep muted for reliable autoplay; Connect button will unlock */}
          <video ref={videoRef} autoPlay playsInline muted style={styles.avatarVideo} />

          <div style={styles.avatarHint}>
            Click “Connect Avatar” once to start video and unlock audio (browser autoplay policies).
          </div>
        </div>

        <div style={styles.avatarBtns}>
          <button
            onClick={async () => {
              await avatar.connect();
              await unlockAvatarAudio();
            }}
            style={styles.btn}
          >
            Connect Avatar
          </button>

          <button
            onClick={async () => {
              await avatar.disconnect();
            }}
            style={styles.btn}
          >
            Disconnect
          </button>
        </div>
      </div>

      <div style={styles.chat}>
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              ...styles.bubble,
              ...(m.role === "user" ? styles.userBubble : styles.assistantBubble),
            }}
          >
            <div style={styles.role}>{m.role === "user" ? "You" : "Trainer"}</div>
            <div style={styles.content}>{m.content || (m.role === "assistant" && isStreaming ? "…" : "")}</div>
          </div>
        ))}

        {isStreaming && (
          <div style={{ ...styles.typing, ...styles.assistantBubble }}>Trainer is typing…</div>
        )}

        <div ref={bottomRef} />
      </div>

      <div style={styles.inputBar}>
        <textarea
          style={styles.textarea}
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
          disabled={isStreaming}
        />

        <button
          onClick={stt.toggle}
          style={{ ...styles.sendBtn, ...(stt.isMicOn ? styles.micOn : styles.micOff) }}
          title={stt.isMicOn ? "Turn mic off" : "Turn mic on"}
        >
          {stt.isMicOn ? "🎙️ Mic On" : "🎙️ Mic Off"}
        </button>

        <button onClick={send} style={styles.sendBtn} disabled={!canSend}>
          Send
        </button>
      </div>
    </div>
  );
}

const styles = {
  page: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto",
    background: "#0b0f14",
    color: "#e6edf3",
  },
  header: {
    padding: "14px 16px",
    borderBottom: "1px solid #1f2a37",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: { fontSize: 16, fontWeight: 700 },
  sub: { fontSize: 12, opacity: 0.7 },
  controls: { display: "flex", alignItems: "center", gap: 10 },
  label: { fontSize: 12, opacity: 0.9, display: "flex", alignItems: "center" },
  num: {
    width: 64,
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid #1f2a37",
    background: "#0f1620",
    color: "#e6edf3",
  },
  btn: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #1f2a37",
    background: "#0f1620",
    color: "#e6edf3",
    cursor: "pointer",
  },
  btnDanger: { borderColor: "#7f1d1d", background: "#2a0f12" },

  avatarBar: {
    padding: 12,
    borderBottom: "1px solid #1f2a37",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  avatarLeft: { display: "flex", flexDirection: "column", gap: 8 },
  avatarStatus: { fontSize: 12, opacity: 0.85 },
  avatarError: { marginLeft: 8, color: "#fca5a5" },
  avatarVideo: {
    width: 320,
    height: 240,
    borderRadius: 12,
    background: "#000",
    border: "1px solid #1f2a37",
  },
  avatarHint: { fontSize: 12, opacity: 0.65, maxWidth: 320 },
  avatarBtns: { display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch" },

  chat: {
    flex: 1,
    overflow: "auto",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  bubble: {
    maxWidth: "820px",
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid #1f2a37",
    whiteSpace: "pre-wrap",
    lineHeight: 1.35,
  },
  userBubble: { alignSelf: "flex-end", background: "#101b2a" },
  assistantBubble: { alignSelf: "flex-start", background: "#0f1620" },
  role: { fontSize: 11, opacity: 0.65, marginBottom: 6 },
  content: { fontSize: 14 },
  typing: {
    maxWidth: 240,
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid #1f2a37",
    opacity: 0.8,
  },

  inputBar: {
    padding: 12,
    borderTop: "1px solid #1f2a37",
    display: "flex",
    gap: 10,
    alignItems: "flex-end",
  },
  textarea: {
    flex: 1,
    resize: "none",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #1f2a37",
    background: "#0f1620",
    color: "#e6edf3",
    outline: "none",
    fontSize: 14,
  },
  sendBtn: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #1f2a37",
    background: "#1f6feb",
    color: "white",
    cursor: "pointer",
    opacity: 1,
  },

  micOn: { background: "#16a34a" },
  micOff: { background: "#334155" },
};
