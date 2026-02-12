import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5050";
console.log("[useLiveAvatar] API_BASE =", API_BASE);

export function useLiveAvatar({ videoRef, avatar_id, voice = "en-US-JennyNeural" } = {}) {
  const [status, setStatus] = useState("idle"); // idle | connecting | ready | speaking | error
  const [lastError, setLastError] = useState("");

  const roomRef = useRef(null);
  const sessionIdRef = useRef(null);

  const safeClose = useCallback(async () => {
    try {
      if (roomRef.current) {
        try { await roomRef.current.disconnect(); } catch {}
        roomRef.current = null;
      }
      sessionIdRef.current = null;

      if (videoRef?.current) {
        try { videoRef.current.srcObject = null; } catch {}
      }
    } catch {}
  }, [videoRef]);

  const connect = useCallback(async () => {
    if (!avatar_id) {
      setStatus("error");
      setLastError("Missing avatar_id");
      return;
    }
    if (status === "connecting" || status === "ready" || status === "speaking") return;

    setStatus("connecting");
    setLastError("");

    try {
      const sRes = await fetch(`${API_BASE}/api/liveavatar/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ avatar_id }),
      });
      const s = await sRes.json();
      if (!sRes.ok || s.error) throw new Error(s.error || "Failed to create session");

      sessionIdRef.current = s.session_id;

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track) => {
        try {
          if (track.kind === Track.Kind.Video && videoRef?.current) track.attach(videoRef.current);
          if (track.kind === Track.Kind.Audio) track.attach(); // creates <audio>
        } catch (e) {
          console.warn("track attach error:", e);
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        setStatus("error");
        setLastError("LiveKit disconnected");
      });

      await room.connect(s.livekit_url, s.livekit_token);
      setStatus("ready");
    } catch (e) {
      console.error(e);
      setStatus("error");
      setLastError(String(e?.message || e));
      await safeClose();
    }
  }, [avatar_id, status, safeClose, videoRef]);

  const disconnect = useCallback(async () => {
    setStatus("idle");
    setLastError("");
    await safeClose();
  }, [safeClose]);

  const stopSpeaking = useCallback(async () => {
    try {
      const session_id = sessionIdRef.current;
      if (!session_id) return;

      await fetch(`${API_BASE}/api/liveavatar/interrupt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id }),
      });

      setStatus("ready");
    } catch {}
  }, []);

  const speak = useCallback(async (text) => {
    const t = String(text || "").trim();
    if (!t) return;

    const session_id = sessionIdRef.current;
    if (!session_id) return;

    try {
      setStatus("speaking");

      await fetch(`${API_BASE}/api/liveavatar/speak`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id, text: t, voice }),
      });

      setStatus("ready");
    } catch (e) {
      console.error(e);
      setStatus("error");
      setLastError(String(e?.message || e));
    }
  }, [voice]);

  useEffect(() => () => { safeClose(); }, [safeClose]);

  return { status, lastError, connect, disconnect, speak, stopSpeaking };
}
