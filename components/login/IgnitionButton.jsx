import styles from '../../styles/login.module.css';

/**
 * The primary action. Gold fill, a sheen that sweeps once on reveal and again on hover,
 * and a progress rail while `loading` — which keeps the parent's existing loading state.
 */
export function IgnitionButton({ loading, children, sheenOnce, ...rest }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className={`${styles.btn} ${sheenOnce ? styles.btnSheenOnce : ''}`}
      {...rest}
    >
      {loading ? (
        <span className={styles.progressRail} aria-label="Signing in" />
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
