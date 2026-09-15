import { Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';
import styles from '../../styles/login.module.css';
import GlassField from './GlassField';
import { IgnitionButton, SystemStatus } from './IgnitionButton';

/**
 * The glass sign-in card. PRESENTATION ONLY — every value and handler is a prop, owned
 * by pages/login.js. No auth call, no firebase import, no session logic here.
 *
 * Reveal is pure CSS: each row carries `.reveal`, and login.module.css staggers them via
 * :nth-child animation-delays under `.seqFull`. No Framer Motion, no JS timeline.
 */
export default function SignInCard({
  instant, shake, reject,
  email, setEmail, password, setPassword,
  showPw, setShowPw, remember, setRemember,
  loading, onSubmit, onForgot,
  emailRef, passwordRef,
}) {
  return (
    <div className={`${styles.card} ${styles.revealCard} ${shake ? styles.cardShake : ''} ${reject ? styles.cardReject : ''}`}>
      {/* brand block */}
      <div className={styles.reveal} style={{ textAlign: 'center', marginBottom: 24 }}>
        <img
          src="/icons/icon-512.png"
          alt=""
          width={72}
          height={72}
          style={{ borderRadius: '50%', objectFit: 'contain', margin: '0 auto 14px', display: 'block', border: '2px solid rgba(212,175,55,0.5)', boxShadow: '0 0 24px rgba(212,175,55,0.18)' }}
        />
        <p style={{ color: '#e9c766', fontSize: 14, letterSpacing: '0.14em', fontWeight: 700 }}>
          SRI BABA BALAJI MARUTI CARE
        </p>
      </div>

      <form onSubmit={onSubmit}>
        <div className={styles.reveal}>
          <GlassField
            id="login-email"
            ref={emailRef}
            label="Email"
            type="email"
            icon={<Mail size={16} />}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="owner@balaji.com"
          />
        </div>

        <div className={styles.reveal}>
          <GlassField
            id="login-password"
            ref={passwordRef}
            label="Password"
            type={showPw ? 'text' : 'password'}
            icon={<Lock size={16} />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
            trailing={(
              <button
                type="button"
                aria-label={showPw ? 'Hide password' : 'Show password'}
                onClick={() => setShowPw((s) => !s)}
                className={styles.pwToggle}
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            )}
          />
        </div>

        <div className={styles.reveal} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{ accentColor: '#d4af37', width: 14, height: 14 }}
            />
            <span style={{ fontSize: 11, color: 'rgba(210,205,192,0.6)' }}>Remember me</span>
          </label>
          <button
            type="button"
            onClick={onForgot}
            className="hover:underline"
            style={{ fontSize: 11, color: 'rgba(233,199,102,0.8)', background: 'none' }}
          >
            Forgot password?
          </button>
        </div>

        <div className={styles.reveal}>
          <IgnitionButton loading={loading} sheenOnce={!instant}>
            ENTER WORKSHOP <ArrowRight size={16} />
          </IgnitionButton>
        </div>
      </form>

      <div className={styles.reveal} style={{ textAlign: 'center', marginTop: 18 }}>
        <SystemStatus />
      </div>
    </div>
  );
}
