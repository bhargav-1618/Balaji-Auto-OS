// hooks/useBarcodeScanner.js
// Issue 7.1 (Stock Operations review) — one shared camera/barcode-detection
// primitive, not a one-off built into Receive Stock. Uses the browser-native
// BarcodeDetector + getUserMedia APIs (no new npm dependency); the brief asks
// for scanning "where the device/browser supports it", so this is feature-
// detected and callers are expected to hide the entry point entirely when
// `isBarcodeScanSupported()` is false rather than showing a broken button.
import { useState, useRef, useCallback, useEffect } from 'react';

export function isBarcodeScanSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window
    && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

/**
 * `onDetect(rawValue)` fires once per scan session (the scanner stops itself
 * after the first successful read — the caller decides what happens next:
 * populate a search field, look up a part, etc.).
 */
export function useBarcodeScanner(onDetect) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const detectorRef = useRef(null);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    setScanning(false);
  }, []);

  const start = useCallback(async () => {
    setError('');
    if (!isBarcodeScanSupported()) { setError('Barcode scanning is not supported on this device/browser.'); return; }
    try {
      detectorRef.current = new window.BarcodeDetector({ formats: FORMATS });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setScanning(true);
      const loop = async () => {
        if (!videoRef.current || !detectorRef.current) return;
        try {
          const codes = await detectorRef.current.detect(videoRef.current);
          if (codes && codes.length) { onDetectRef.current?.(codes[0].rawValue); stop(); return; }
        } catch {
          // Transient per-frame detection errors (e.g. a frame mid-decode) — keep scanning.
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      setError('Could not access the camera. Check permissions and try again.');
      stop();
    }
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  return { videoRef, scanning, error, start, stop };
}
