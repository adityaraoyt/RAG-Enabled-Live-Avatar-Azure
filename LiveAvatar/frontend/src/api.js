const API_BASE = "http://localhost:5050";

export async function streamTrainerResponse({
  conversationId,
  question,
  topK = 8,
  onMeta,
  onToken,
  onDone,
  onError,
  signal,
}) {
  const res = await fetch(`${API_BASE}/api/trainer/respond/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, question, topK }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Stream request failed: ${res.status} ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let buffer = "";

  // Minimal SSE parser
  const emitEvent = (rawEvent) => {
    const lines = rawEvent.split("\n").filter(Boolean);
    let eventName = "message";
    let dataStr = "";

    for (const line of lines) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) dataStr += line.slice(5).trim();
    }

    if (!dataStr) return;

    let payload;
    try {
      payload = JSON.parse(dataStr);
    } catch {
      payload = { raw: dataStr };
    }

    if (eventName === "meta") onMeta?.(payload);
    else if (eventName === "token") onToken?.(payload.token ?? "");
    else if (eventName === "done") onDone?.(payload);
    else if (eventName === "error") onError?.(payload);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by blank line "\n\n"
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      emitEvent(rawEvent);
    }
  }
}
