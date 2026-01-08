import { useCallback, useRef, useState } from "react";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";

export function useAzureStt({ onPartial, onFinal, onError, language = "en-US" }) {
  const [isMicOn, setIsMicOn] = useState(false);
  const recognizerRef = useRef(null);

  const start = useCallback(async () => {
    if (isMicOn) return;

    try {
      const r = await fetch("/api/azure/speech-token");
      const { token, region, error } = await r.json();
      if (!r.ok || error) throw new Error(error || "Failed to get speech token");

      const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region);
      speechConfig.speechRecognitionLanguage = language;

      const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
      const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
      recognizerRef.current = recognizer;

      recognizer.recognizing = (_s, e) => onPartial?.(e?.result?.text || "");
      recognizer.recognized = (_s, e) => {
        const t = e?.result?.text || "";
        if (t.trim()) onFinal?.(t);
      };
      recognizer.canceled = (_s, e) => onError?.(e);
      recognizer.sessionStopped = () => {};

      await new Promise((resolve, reject) =>
        recognizer.startContinuousRecognitionAsync(resolve, reject)
      );

      setIsMicOn(true);
    } catch (e) {
      setIsMicOn(false);
      onError?.(e);
    }
  }, [isMicOn, onPartial, onFinal, onError, language]);

  const stop = useCallback(async () => {
    const rec = recognizerRef.current;
    recognizerRef.current = null;

    try {
      if (rec) {
        await new Promise((resolve) => rec.stopContinuousRecognitionAsync(resolve, resolve));
        rec.close?.();
      }
    } finally {
      setIsMicOn(false);
      onPartial?.("");
    }
  }, [onPartial]);

  const toggle = useCallback(() => (isMicOn ? stop() : start()), [isMicOn, start, stop]);
  const disconnect = useCallback(() => stop(), [stop]);

  return { isMicOn, toggle, disconnect };
}
