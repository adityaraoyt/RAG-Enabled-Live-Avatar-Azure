import { useEffect, useMemo, useRef, useState } from "react";
import { streamTrainerResponse } from "../api";

function newConversationId() {
  return (crypto?.randomUUID?.() ?? `conv_${Date.now()}_${Math.random()}`)
    .toString();
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

  const canSend = input.trim().length > 0 && !isStreaming;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const startNewChat = () => {
    // stop current stream if any
    abortRef.current?.abort?.();
    abortRef.current = null;
    setIsStreaming(false);

    setConversationId(newConversationId());
    setMessages([
      {
        id: "sys",
        role: "assistant",
        content: "New chat started. Ask your next question.",
      },
    ]);
  };

  const stop = () => {
    abortRef.current?.abort?.();
    abortRef.current = null;
    setIsStreaming(false);
  };

  const send = async () => {
    const question = input.trim();
    if (!question) return;

    setInput("");

    const userMsgId = `u_${Date.now()}`;
    const assistantMsgId = `a_${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: question },
      { id: assistantMsgId, role: "assistant", content: "" },
    ]);

    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamTrainerResponse({
        conversationId,
        question,
        topK,
        signal: controller.signal,
        onMeta: (_meta) => {
          // You can store meta.sources if you want a "show sources" drawer later
        },
        onToken: (token) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, content: m.content + token } : m
            )
          );
        },
        onDone: () => {
          setIsStreaming(false);
          abortRef.current = null;
        },
        onError: (payload) => {
          setIsStreaming(false);
          abortRef.current = null;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: (m.content || "") + `\n\n[Error] ${payload?.error || "Unknown error"}` }
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
          m.id === assistantMsgId
            ? { ...m, content: `[Error] ${String(e?.message || e)}` }
            : m
        )
      );
    }
  };

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

      <div style={styles.chat}>
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              ...styles.bubble,
              ...(m.role === "user" ? styles.userBubble : styles.assistantBubble),
            }}
          >
            <div style={styles.role}>
              {m.role === "user" ? "You" : "Trainer"}
            </div>
            <div style={styles.content}>
              {m.content || (m.role === "assistant" && isStreaming ? "…" : "")}
            </div>
          </div>
        ))}
        {isStreaming && (
          <div style={{ ...styles.typing, ...styles.assistantBubble }}>
            Trainer is typing…
          </div>
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
};
