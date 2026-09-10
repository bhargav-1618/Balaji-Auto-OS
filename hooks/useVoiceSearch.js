// hooks/useVoiceSearch.js
// Refactor Phase 14 — extracted verbatim from components/InventoryDashboard.js.
// One cohesive concern: Web Speech API -> text. Handles the secure-context /
// permission / mic-warmup edge cases, streams interim results for live feedback,
// and toggles start/stop on repeated calls. The ONLY coupling to the container is
// where the captured text goes: `onTranscript(text)` replaces the direct
// `setSearch(text)` calls (interim + final). Toast feedback stays here since it is
// part of the voice flow ("here's what I heard"). No Firestore, no navigation, no
// business logic.
import { useState, useRef } from 'react';
import toast from '../lib/toast';

export function useVoiceSearch(onTranscript) {
  const [listening, setListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState('en-IN'); // CHANGE-04: en-IN | te-IN
  const [liveTranscript, setLiveTranscript] = useState(''); // Fix 1: live voice feedback
  const recognitionRef = useRef(null); // hold the recognition instance so it isn't GC'd

  async function startVoiceSearch() {
    const SpeechRecognition =
      typeof window !== 'undefined' &&
      (window.SpeechRecognition || window.webkitSpeechRecognition);

    if (!SpeechRecognition) {
      toast.error('Voice search needs Google Chrome or Microsoft Edge.');
      return;
    }

    // ROOT CAUSE #1: the Web Speech API only works in a *secure context*.
    // localhost is fine, but opening the dev server over a LAN IP like
    // http://192.168.x.x:3000 (common when testing on a phone) is NOT secure,
    // so recognition silently never captures. Tell the user exactly that.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      toast.error('Voice search needs HTTPS. Open the site over https:// (or localhost), not an http LAN address.');
      return;
    }

    // Second tap stops immediately and reliably. We DETACH the handlers first so
    // no late onresult/onend can revive state, then stop() AND abort() to kill the
    // session instantly. The live transcript already sits in `search`, so the
    // query is preserved.
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      setListening(false);
      setLiveTranscript('');
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.stop();
        rec.abort?.();
      } catch (_) {}
      return;
    }

    // ROOT CAUSE #2: permission / no warmed-up mic. Explicitly acquire the mic
    // first via getUserMedia — this triggers the permission prompt reliably and
    // confirms a working input device before we ever call recognition.start().
    // (Guard mediaDevices itself: it's undefined on some older/insecure setups.)
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop()); // release; recognition opens its own
      } catch (err) {
        console.error('Mic permission error:', err);
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
          toast.error('Microphone access denied. Please check browser permissions.');
        } else if (err?.name === 'NotFoundError') {
          toast.error('No microphone detected. Please connect/enable a mic.');
        } else {
          toast.error('Could not access the microphone.');
        }
        return;
      }
    }

    let recognition;
    try {
      recognition = new SpeechRecognition();
      recognition.lang = voiceLang; // CHANGE-04: EN (en-IN) or Telugu (te-IN)
      recognition.continuous = true;      // keep listening — won't auto-stop on pauses
      recognition.interimResults = true;  // stream partial words for live feedback
      recognition.maxAlternatives = 1;
    } catch (err) {
      console.error('Voice init failed:', err);
      toast.error('Could not initialise voice search on this device.');
      return;
    }

    // Accumulated transcript lives on the recognition instance so the Stop
    // handler (and onend) can read the final text.
    recognition._finalText = '';

    recognition.onstart = () => {
      setListening(true);
      setLiveTranscript('');
    };

    recognition.onresult = (e) => {
      // FIX 1: don't grab only the first frame — join EVERY result frame so we
      // never truncate "brake pads" down to "pads".
      const fullTranscript = Array.from(e.results)
        .map((r) => r[0]?.transcript || '')
        .join('')
        .trim();
      recognition._finalText = fullTranscript;
      setLiveTranscript(fullTranscript); // Fix 1: live feedback box
      if (fullTranscript) onTranscript(fullTranscript); // filter the table live
    };

    recognition.onerror = (e) => {
      setListening(false);
      recognitionRef.current = null;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        toast.error('Microphone access denied. Please check browser permissions.');
      } else if (e.error === 'audio-capture') {
        toast.error('No microphone detected. Please enable a mic and try again.');
      } else if (e.error === 'network') {
        toast.error('Voice service needs internet. Check your connection.');
      } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
        toast.error('Voice search failed. Please try again.');
      }
    };

    recognition.onend = () => {
      setListening(false);
      const finalText = (recognition._finalText || '').trim();
      recognitionRef.current = null;
      // Apply the captured transcript to the search query.
      if (finalText) {
        onTranscript(finalText);
        toast.success(`Search: “${finalText}”`);
      }
      setLiveTranscript('');
    };

    try {
      recognitionRef.current = recognition; // retain reference (avoid GC)
      recognition.start();
    } catch (err) {
      console.error('Voice start failed:', err);
      setListening(false);
      recognitionRef.current = null;
      toast.error('Could not start voice search. Please try again.');
    }
  }

  return { listening, voiceLang, setVoiceLang, liveTranscript, startVoiceSearch };
}
