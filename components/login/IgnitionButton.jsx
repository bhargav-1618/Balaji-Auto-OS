import { useEffect, useState } from 'react';
import styles from '../../styles/login.module.css';

// Purely cosmetic label cycling while `loading` is true — never delays or gates the real
// auth call in pages/login.js, just decorates whatever time the actual request naturally
// takes. If auth resolves before the cycle advances, the button simply unmounts mid-cycle.
const PHASES = ['AUTHENTICATING', 'VERIFYING'];

/**
 * The primary action. Gold fill, a sheen that sweeps once on reveal and again on hover,
 * and a progress rail + cycling status text while `loading` — which keeps the parent's
 * existing loading state; this component only decorates it, never controls it.
 */
export function IgnitionButton({ loading, children, sheenOnce, ...rest }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!loading) { setPhase(0); return undefined; }
    const t = setInterval(() => setPhase((p) => (p + 1) % PHASES.length), 750);
    return () => clearInterval(t);
  }, [loading]);

  return (
    <button
      type="submit"
      disabled={loading}
      className={`${styles.btn} ${sheenOnce ? styles.btnSheenOnce : ''}`}
      {...rest}
    >
      {loading ? (
        <span className={styles.loadingState} aria-live="polite">
          <span className={styles.loadingLabel}>{PHASES[phase]}</span>
          <span className={styles.progressRail} />
        </span>
      ) : (
        <>
          <span className={styles.sheen} aria-hidden="true" />
          {children}
        </>
      )}
    </button>
  );
}

/** "● system online" — the boot payoff. Purely decorative; aria-hidden. */
export function SystemStatus({ label = 'System online' }) {
  return (
    <span className={styles.status} aria-hidden="true">
      <span className={styles.statusDot} />
      {label}
    </span>
  );
}
