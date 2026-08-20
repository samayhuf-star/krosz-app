import { useState, useEffect, useRef, useCallback } from 'react';

// Lightweight Web Speech API hook for the "Speak" input in onboarding.
// Gracefully unsupported on some browsers — `supported` lets the UI hide mic.
export function useSpeech(onFinal) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const cbRef = useRef(onFinal);
  cbRef.current = onFinal;

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    setSupported(true);
    const r = new SR();
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      const text = Array.from(e.results).map((x) => x[0].transcript).join('');
      const isFinal = e.results[e.results.length - 1].isFinal;
      if (isFinal) cbRef.current && cbRef.current(text.trim());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recRef.current = r;
    return () => { try { recRef.current && recRef.current.stop(); } catch {} };
  }, []);

  const start = useCallback(() => {
    const r = recRef.current;
    if (!r || listening) return;
    try { r.start(); setListening(true); } catch {}
  }, [listening]);
  const stop = useCallback(() => {
    const r = recRef.current;
    if (!r) return;
    try { r.stop(); } catch {}
    setListening(false);
  }, []);

  return { supported, listening, start, stop };
}