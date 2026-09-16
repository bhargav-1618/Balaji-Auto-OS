import styles from '../../styles/login.module.css';

/**
 * The single brand heading for the whole scene — logo badge + product name + business
 * name + tagline. Previously the icon/business-name lived inside SignInCard's own brand
 * block (appropriate for the old two-panel layout, where the left panel only had this
 * wordmark and the right panel's card needed its own identity). Now everything sits in
 * one floating console over the photo, so one brand block above the fields covers both —
 * repeating it inside the card would just be visual noise.
 *
 * Letter-spacing tightens wide -> normal as it fades in — done purely with the CSS
 * keyframes in login.module.css (wordmarkIn / revealUp). No JS animation. The parent sets
 * .seqFull or .seqInstant on the scene root, which drives timing.
 */
export default function Wordmark() {
  return (
    <div className={styles.brandBlock}>
      <img
        src="/icons/icon-512.png"
        alt=""
        width={38}
        height={38}
        className={`${styles.brandIcon} ${styles.wordmarkAnim}`}
      />
      <h1 className={`${styles.wordmark} ${styles.wordmarkAnim}`}>
        BALAJI <span className={styles.wordmarkGold}>AUTO OS</span>
      </h1>
      <p className={`${styles.brandSub} ${styles.taglineAnim}`}>Sri Baba Balaji Maruti Care</p>
      <p className={`${styles.tagline} ${styles.taglineAnim}`}>
        Built for Workshops That Never Compromise.
      </p>
    </div>
  );
}
