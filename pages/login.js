// pages/login.js — "Ignition" presentation.
// The visual layer is rebuilt (two-panel aurora boot sequence, glass card) but EVERY
// piece of authentication logic below is preserved from the previous version: demo
// login, remember-me + persistence choice, reset email, session-expired toast, and the
// success -> /outro.mp4 departure. Presentation-only rebuild.
import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import { auth, signInWithEmailAndPassword, sendPasswordResetEmail } from '../lib/firebase';
import { setPersistence, browserLocalPersistence, browserSessionPersistence } from 'firebase/auth';
import toast from '../lib/toast';
import notify from '../components/common/notify';
import styles from '../styles/login.module.css';
import AuroraBackground from '../components/login/AuroraBackground';
import Wordmark from '../components/login/Wordmark';
import SignInCard from '../components/login/SignInCard';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function Login() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('expired') === '1') {
      // Universal Notification Architecture — the shared Lock icon (same one every
      // other permission/access-blocked toast in the app uses) via notify.jsx,
      // instead of a one-off emoji reached for before that helper existed.
      notify.permissionDenied('Session expired after a long period of inactivity. Please sign in again.');
    }
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [enteringDemo, setEnteringDemo] = useState(false);
  const [success, setSuccess] = useState(false);
  const [outro, setOutro] = useState(false);
  const [hasOutro, setHasOutro] = useState(false);
  const [outroFade, setOutroFade] = useState(false);
  const [shake, setShake] = useState(false);
  const [reject, setReject] = useState(false);
  // null = not yet decided (SSR + first paint). The effect resolves it to true (instant)
  // or false (full boot) after reading the session flag. Rendering NEITHER sequence class
  // until then avoids a flash: with `booted` defaulting to a value, SSR would paint one
  // path and the effect could flip to the other, making the card appear then re-hide.
  const [booted, setBooted] = useState(null);
  const [needle, setNeedle] = useState(false);

  const outroRef = useRef(null);
  const sceneRef = useRef(null);
  const departHref = useRef('/');
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  // Synchronous re-entry guard. `disabled={loading}` is not enough on its own: setLoading
  // runs only after `await setPersistence`, so a double-click or rapid Enter within that
  // window would fire a second auth request before React re-rendered the disabled state.
  // A ref flips in the same tick, before any await, so the second call returns immediately.
  const submitting = useRef(false);

  useEffect(() => {
    try { sessionStorage.removeItem('maruti_demo'); sessionStorage.removeItem('maruti_demo_admin'); } catch {}
    let prefilled = false;
    try { const saved = localStorage.getItem('maruti_login_email'); if (saved) { setEmail(saved); setRemember(true); prefilled = true; } } catch {}
    fetch('/outro.mp4', { method: 'HEAD' }).then((r) => setHasOutro(r.ok)).catch(() => setHasOutro(false));

    // Autofocus the first field the user actually needs — but never on touch, where it
    // yanks the on-screen keyboard up over the whole boot experience. If email was
    // restored from "remember me", the returning owner only needs their password, so
    // focus that instead. Delay until after the sequence so focus doesn't fight the
    // reveal animation.
    const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
    const focusTimers = [];
    if (!isTouch) {
      const focusField = () => {
        const el = prefilled ? passwordRef.current : emailRef.current;
        // don't steal focus if the user already started typing somewhere
        if (el && (!document.activeElement || document.activeElement === document.body)) el.focus();
      };
      focusTimers.push(setTimeout(focusField, 60));   // instant path
    }

    let firstThisSession = true;
    try { firstThisSession = sessionStorage.getItem('balaji_booted') !== '1'; } catch {}
    if (firstThisSession && !reduced()) {
      setBooted(false);
      setNeedle(true);
      try { sessionStorage.setItem('balaji_booted', '1'); } catch {}
      const t = setTimeout(() => setNeedle(false), 420);
      // on the full sequence, focus lands after the fields have revealed (~2.1s)
      if (!isTouch) focusTimers.push(setTimeout(() => {
        const el = prefilled ? passwordRef.current : emailRef.current;
        if (el && (!document.activeElement || document.activeElement === document.body)) el.focus();
      }, 2150));
      return () => { clearTimeout(t); focusTimers.forEach(clearTimeout); };
    }
    setBooted(true);   // returning visit or reduced motion → instant, no sequence
    return () => { focusTimers.forEach(clearTimeout); };
  }, []);

  // ───────────────────────── AUTH — preserved ──────────────────────
  async function handleLogin(e) {
    e.preventDefault();
    // Re-entry guard (see the `submitting` ref above): block a second submission that
    // arrives before React has re-rendered the disabled button. Validation runs first so
    // an empty-field attempt still gives feedback without arming the guard.
    if (!email || !password) { toast.error('Enter your email and password', { id: 'login-error' }); return; }
    if (submitting.current) return;
    submitting.current = true;
    try { remember ? localStorage.setItem('maruti_login_email', email.trim()) : localStorage.removeItem('maruti_login_email'); } catch (e) { console.error('[login] could not save email', e); }

    try {
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    } catch (e) {
      console.error('[login] could not set session persistence', e);
    }
    const em = email.trim().toLowerCase();
    if (em === 'demo@balajiautoos.com' && password === 'Demo@123') {
      try { sessionStorage.setItem('maruti_demo', '1'); sessionStorage.removeItem('maruti_demo_admin'); } catch {}
      depart('/?demo=1');
      return;
    }
    setLoading(true);
    try {
      try { sessionStorage.removeItem('maruti_demo'); sessionStorage.removeItem('maruti_demo_admin'); } catch {}
      await signInWithEmailAndPassword(auth, email, password);
      depart('/');
    } catch (err) {
      setLoading(false);
      submitting.current = false;   // failed — allow a retry
      setShake(true); setTimeout(() => setShake(false), 420);
      setReject(true); setTimeout(() => setReject(false), 700);
      const msg = err.code === 'auth/invalid-credential' ? 'Wrong email or password'
        : err.code === 'auth/too-many-requests' ? 'Too many attempts. Try again later.'
          : 'Login failed. Check your connection.';
      toast.error(msg, { id: 'login-error' });
    }
  }

  function depart(href) {
    departHref.current = href;
    try { sessionStorage.setItem('maruti_arrival', '1'); } catch {}
    if (reduced()) { window.location.href = href; return; }
    setSuccess(true);
    setTimeout(() => {
      setSuccess(false);
      if (hasOutro) setOutro(true);
      else window.location.href = href;
    }, 850);
  }
  function onOutroTime() {
    const v = outroRef.current;
    if (!v || outroFade || !v.duration) return;
    if (v.duration - v.currentTime <= 0.5) {
      setOutroFade(true);
      setTimeout(() => { window.location.href = departHref.current; }, 420);
    }
  }
  function launchDemo() {
    if (submitting.current) return;
    submitting.current = true;
    setEnteringDemo(true);
    try { sessionStorage.setItem('maruti_demo', '1'); sessionStorage.removeItem('maruti_demo_admin'); } catch {}
    depart('/?demo=1');
  }
  async function handleForgot() {
    if (!email) { toast.error('Enter your email first, then tap reset.'); return; }
    try { await sendPasswordResetEmail(auth, email); toast.success('Password reset link sent — check your email.'); }
    catch (err) { toast.error(err?.code === 'auth/user-not-found' ? 'No account with that email.' : 'Could not send reset email.'); }
  }
  // ───────────────────────── END auth ───────────────────────────────────────

  const instant = booted === true;
  const seqClass = booted === null ? styles.seqPre : (instant ? styles.seqInstant : styles.seqFull);

  return (
    <>
      <Head><title>Sign in — Sri Baba Balaji Maruti Care</title></Head>

      <div ref={sceneRef} className={`${styles.scene} ${seqClass}`} style={{ display: 'flex' }}>
        <AuroraBackground />
        <div className={styles.vignette} aria-hidden="true" />
        {needle && <div className={`${styles.needle} ${styles.needleOn}`} aria-hidden="true" />}

        <div className="loginGrid">
          <div className="loginLeft">
            <Wordmark />
          </div>

          <div className="loginRight">
            <SignInCard
              instant={instant}
              shake={shake}
              reject={reject}
              email={email}
              setEmail={setEmail}
              password={password}
              setPassword={setPassword}
              showPw={showPw}
              setShowPw={setShowPw}
              remember={remember}
              setRemember={setRemember}
              loading={loading}
              onSubmit={handleLogin}
              onForgot={handleForgot}
              emailRef={emailRef}
              passwordRef={passwordRef}
            />

            <div className={styles.demoWrap}>
              <div className={styles.orRow}>
                <span className={styles.orLine} />
                <span className={styles.orText}>OR</span>
                <span className={styles.orLine} />
              </div>
              <button
                type="button"
                disabled={enteringDemo}
                onClick={launchDemo}
                className={styles.demoBtn}
              >
                {enteringDemo ? 'ENTERING…' : 'LAUNCH INTERACTIVE DEMO'}
              </button>
              <p className={styles.loginFooter}>
                SBB MARUTI CARE · GAJUWAKA · EST. 1998
              </p>
            </div>
          </div>
        </div>

        {success && (
          <div
            className={styles.successOverlay}
            style={{ position: 'fixed', inset: 0, zIndex: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,8,9,0.4)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)' }}
          >
            <div
              className={styles.successCard}
              style={{ borderRadius: 20, padding: '32px 40px', textAlign: 'center', background: 'linear-gradient(200deg, rgba(28,29,33,0.92), rgba(15,16,18,0.95))', border: '1px solid rgba(212,175,55,0.35)', boxShadow: '0 30px 80px rgba(0,0,0,0.6)' }}
            >
              <span style={{ margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: '50%', border: '2px solid #d4af37' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.2 4.2L19 7" stroke="#d4af37" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <p style={{ color: '#ece8dd', fontSize: 16, fontWeight: 600 }}>Login Successful</p>
              <p style={{ color: 'rgba(200,195,182,0.5)', fontSize: 11.5, marginTop: 5 }}>Loading Garage Management ERP…</p>
            </div>
          </div>
        )}

        {outro && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 140, background: '#000', opacity: outroFade ? 0 : 1, transition: 'opacity 500ms' }}>
            <video
              ref={outroRef} src="/outro.mp4" autoPlay muted playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onTimeUpdate={onOutroTime}
              onEnded={() => { window.location.href = departHref.current; }}
              onError={() => { window.location.href = departHref.current; }}
            />
          </div>
        )}
      </div>

      <style jsx>{`
        .loginGrid {
          position: relative; z-index: 10; width: 100%; min-height: 100dvh;
          display: flex; flex-direction: column; justify-content: center; align-items: center;
          gap: 8px; padding: max(1.5rem, env(safe-area-inset-top)) 1.25rem max(1.5rem, env(safe-area-inset-bottom));
        }
        .loginLeft { display: none; }
        .loginRight {
          width: 100%; max-width: 400px;
          display: flex; flex-direction: column; align-items: stretch;
          gap: 16px;   /* ONE spacing scale for card → OR → demo (no stacked margins) */
        }
        @media (min-width: 1024px) {
          .loginGrid { flex-direction: row; gap: 0; padding-left: 6vw; padding-right: 6vw; align-items: center; }
          .loginLeft { display: block; flex: 0 0 55%; padding-right: 4vw; }
          .loginRight { flex: 0 0 45%; max-width: 420px; align-items: stretch; }
        }
      `}</style>
    </>
  );
}
