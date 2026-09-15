import { useEffect, useRef } from 'react';
import styles from '../../styles/login.module.css';

/**
 * The only light source on the page: two slow gold/amber blobs over charcoal.
 * transform-animated in CSS (GPU), with a subtle pointer parallax written at most once
 * per frame. No blue/purple/cyan/green — brand palette only.
 */
export default function AuroraBackground({ parallax = true }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!parallax) return undefined;
    // Touch devices have no pointer parallax — don't attach a listener that never fires.
    if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) return undefined;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return undefined;

    const el = ref.current;
    if (!el) return undefined;
    let raf = 0; let nx = 0; let ny = 0;
    const flush = () => {
      raf = 0;
      el.style.setProperty('--px', nx.toFixed(4));
      el.style.setProperty('--py', ny.toFixed(4));
    };
    const move = (e) => {
      nx = e.clientX / window.innerWidth - 0.5;
      ny = e.clientY / window.innerHeight - 0.5;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => { window.removeEventListener('pointermove', move); if (raf) cancelAnimationFrame(raf); };
  }, [parallax]);

  return (
    <div ref={ref} className={styles.aurora} aria-hidden="true">
      <div className={styles.auroraParallax}>
        <span className={`${styles.blob} ${styles.blob1}`} />
        <span className={`${styles.blob} ${styles.blob2}`} />
      </div>
    </div>
  );
}
