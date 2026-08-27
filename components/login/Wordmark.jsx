import styles from '../../styles/login.module.css';

/**
 * The nameplate. Letter-spacing tightens wide -> normal as it fades in — done purely
 * with the CSS keyframes in login.module.css (wordmarkIn / revealUp). No JS animation.
 * The parent sets .seqFull or .seqInstant on the scene root, which drives timing.
 */
export default function Wordmark() {
  return (
    <div>
      <h1 className={`${styles.wordmark} ${styles.wordmarkAnim}`}>
        BALAJI <span className={styles.wordmarkGold}>AUTO OS</span>
      </h1>
      <p className={`${styles.tagline} ${styles.taglineAnim}`}>
        Built for Workshops That Never Compromise.
      </p>
    </div>
  );
}
