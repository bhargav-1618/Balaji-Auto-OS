import styles from '../../styles/login.module.css';

/**
 * Fills the gap between the card's own entrance (cardIn) and its real content
 * revealing — previously an empty rounded rectangle with nothing in it for
 * ~300-400ms. A thin scanline sweeps top-to-bottom inside the card while two
 * short HUD status lines tick through, then fades out right as the real form
 * content starts fading in. Purely decorative and timing-driven: no props, no
 * state, no auth involvement. Only rendered during the full boot sequence
 * (see pages/login.js) — never on a returning-visit instant load.
 */
export default function DiagnosticScan() {
  return (
    <div className={styles.diagnosticScan} aria-hidden="true">
      <span className={styles.scanLine} />
      <span className={`${styles.scanStatus} ${styles.scanStatus1}`}>Diagnostics · OK</span>
      <span className={`${styles.scanStatus} ${styles.scanStatus2}`}>Authentication Ready</span>
    </div>
  );
}
