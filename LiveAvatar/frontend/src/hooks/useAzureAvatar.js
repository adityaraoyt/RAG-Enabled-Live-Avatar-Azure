import { useCallback, useEffect, useRef, useState } from "react";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";

/**
 * Azure real-time avatar (WebRTC) hook
 * - connect(): starts WebRTC + AvatarSynthesizer session
 * - speak(text): avatar speaks
 * - stopSpeaking(): barge-in stop
 *
 * Fixes:
 * - Normalizes Azure ICE payload into RTCIceServer[]
 * - Adds recvonly transceivers (video+audio) so tracks arrive reliably
 * - Adds WebRTC debug logging + ontrack logging
 */
export function useAzureAvatar({
  videoRef,
  character = "lisa",
  style = "casual-sitting",
  voice = null, // optional: set a voice name if you want (e.g., "en-US-JennyNeural")
} = {}) {
  const [status, setStatus] = useState("idle"); // idle | connecting | ready | speaking | error
  const [lastError, setLastError] = useState("");

  const pcRef = useRef(null);
  const synthesizerRef = useRef(null);

  function normalizeIce(ice) {
  if (!ice) return [];

  // Case 1: Already RTCIceServer[]
  if (Array.isArray(ice.iceServers)) return ice.iceServers;
  if (Array.isArray(ice.IceServers)) return ice.IceServers;

  // Case 2: Azure relay format: { Urls:[], Username:"", Password:"" }
  if (Array.isArray(ice.Urls) && ice.Urls.length) {
    return [
      {
        urls: ice.Urls,
        username: ice.Username,
        credential: ice.Password,
      },
    ];
  }

  // Case 3: lowercased variant
  if (Array.isArray(ice.urls) && ice.urls.length) {
    return [
      {
        urls: ice.urls,
        username: ice.username,
        credential: ice.password,
      },
    ];
  }

  // Case 4: maybe nested
  const nested =
    ice?.relay ||
    ice?.Relay ||
    ice?.data ||
    ice?.Data ||
    ice?.result ||
    ice?.Result ||
    ice?.token ||
    ice?.Token;

  if (nested && nested !== ice) return normalizeIce(nested);

  // Case 5: single URL string
  if (typeof ice.Urls === "string") {
    return [
      {
        urls: [ice.Urls],
        username: ice.Username,
        credential: ice.Password,
      },
    ];
  }
  if (typeof ice.urls === "string") {
    return [
      {
        urls: [ice.urls],
        username: ice.username,
        credential: ice.password,
      },
    ];
  }

  return [];
}


  const safeClose = useCallback(async () => {
    try {
      const syn = synthesizerRef.current;
      synthesizerRef.current = null;

      if (syn) {
        try {
          if (syn.stopAvatarAsync) await syn.stopAvatarAsync();
          else if (syn.stopAvatar) await syn.stopAvatar();
        } catch {}
        try {
          syn.close?.();
        } catch {}
      }

      const pc = pcRef.current;
      pcRef.current = null;

      if (pc) {
        try {
          pc.getSenders?.().forEach((s) => s.track?.stop?.());
          pc.getReceivers?.().forEach((r) => r.track?.stop?.());
        } catch {}
        try {
          pc.close?.();
        } catch {}
      }

      if (videoRef?.current) {
        videoRef.current.srcObject = null;
      }
    } catch {
      // noop
    }
  }, [videoRef]);

  const connect = useCallback(async () => {
    if (status === "connecting" || status === "ready" || status === "speaking") return;

    setStatus("connecting");
    setLastError("");

    try {
      // 1) get token/region
      const tokRes = await fetch("/api/azure/speech-token");
      const tok = await tokRes.json();
      if (!tokRes.ok || tok.error) throw new Error(tok.error || "Failed to fetch speech token");

      // 2) get ICE / relay token
      const iceRes = await fetch("/api/azure/ice");
      const ice = await iceRes.json();
      console.log("[AVATAR] raw ice payload:", ice);

      if (!iceRes.ok || ice.error) throw new Error(ice.error || "Failed to fetch ICE info");

      // 3) build peer connection (normalize ICE into RTCIceServer[])
      const iceServers = ice?.iceServers || [];
console.log("[AVATAR] iceServers:", iceServers);
console.log("[AVATAR] ice raw:", ice?.raw);

      console.log("[AVATAR] iceServers:", iceServers);

      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;

      // Ask to receive remote media up front (prevents “ready but no video”)
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });

      // Debug logging (very useful)
      pc.oniceconnectionstatechange = () => {
        console.log("[AVATAR] iceConnectionState:", pc.iceConnectionState);
      };
      pc.onconnectionstatechange = () => {
        console.log("[AVATAR] connectionState:", pc.connectionState);
      };
      pc.onsignalingstatechange = () => {
        console.log("[AVATAR] signalingState:", pc.signalingState);
      };
      pc.onicegatheringstatechange = () => {
        console.log("[AVATAR] iceGatheringState:", pc.iceGatheringState);
      };

      pc.ontrack = (e) => {
        console.log("[AVATAR] ontrack kind=", e.track?.kind, "streams=", e.streams?.length);
        if (videoRef?.current && e.streams?.[0]) {
          videoRef.current.srcObject = e.streams[0];
        }
      };

      // 4) speech config
      const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(tok.token, tok.region);
      if (voice) speechConfig.speechSynthesisVoiceName = voice;

      // 5) avatar config
      const avatarConfig = new SpeechSDK.AvatarConfig(character, style);

      // 6) create synthesizer
      const synthesizer = new SpeechSDK.AvatarSynthesizer(speechConfig, avatarConfig);
      synthesizerRef.current = synthesizer;

      // 7) start avatar session (method name varies by SDK version)
      if (synthesizer.startAvatarAsync) {
        await synthesizer.startAvatarAsync(pc);
      } else if (synthesizer.startAvatar) {
        await synthesizer.startAvatar(pc);
      } else {
        throw new Error("AvatarSynthesizer.startAvatarAsync not found (SDK version mismatch).");
      }

      // Helpful: check whether video actually got a stream shortly after connect
      setTimeout(() => {
        const v = videoRef?.current;
        console.log("[AVATAR] video srcObject:", v?.srcObject);
      }, 1500);

      setStatus("ready");
    } catch (e) {
      console.error("Avatar connect error:", e);
      setLastError(String(e?.message || e));
      setStatus("error");
      await safeClose();
    }
  }, [status, character, style, voice, safeClose, videoRef]);

  const disconnect = useCallback(async () => {
    setStatus("idle");
    setLastError("");
    await safeClose();
  }, [safeClose]);

  const stopSpeaking = useCallback(async () => {
    try {
      const syn = synthesizerRef.current;
      if (!syn) return;

      if (syn.stopSpeakingAsync) await syn.stopSpeakingAsync();
      else if (syn.stopSpeaking) await syn.stopSpeaking();

      if (status === "speaking") setStatus("ready");
    } catch {}
  }, [status]);

  const speak = useCallback(async (text) => {
    const t = String(text || "").trim();
    if (!t) return;

    const syn = synthesizerRef.current;
    if (!syn) return;

    try {
      setStatus("speaking");

      if (syn.speakTextAsync) {
        await syn.speakTextAsync(t);
      } else if (syn.speakText) {
        await syn.speakText(t);
      } else {
        throw new Error("AvatarSynthesizer.speakTextAsync not found (SDK version mismatch).");
      }

      setStatus("ready");
    } catch (e) {
      console.error("Avatar speak error:", e);
      setLastError(String(e?.message || e));
      setStatus("error");
    }
  }, []);

  // clean up on unmount
  useEffect(() => {
    return () => {
      safeClose();
    };
  }, [safeClose]);

  return { status, lastError, connect, disconnect, speak, stopSpeaking };
}
