// pages/login.js — v6.1: storyboard panel-1 UI.
// Full-bleed photoreal workshop (car parked, no CSS silhouettes), floating glass
// card right-of-center: logo badge → name → fields (icons) → ENTER WORKSHOP →
// OR → demo box → LAUNCH INTERACTIVE DEMO. Phases 2–6 unchanged (success card
// → /outro.mp4 → smoke clears onto the real dashboard).
import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import { auth, signInWithEmailAndPassword, sendPasswordResetEmail } from '../lib/firebase';
import { setPersistence, browserLocalPersistence, browserSessionPersistence } from 'firebase/auth';
import toast from 'react-hot-toast';

const ORDER = ['card', 'logo', 'name', 'email', 'password', 'meta', 'primary'];

export default function Login() {
  // Surface an expired session instead of silently dumping the user here — otherwise
  // being bounced to login mid-shift looks like a crash.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('expired') === '1') {
      toast('Session expired after a long period of inactivity. Please sign in again.', { icon: '🔒', duration: 6000 });
    }
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [enteringDemo, setEnteringDemo] = useState(false);
  const [stage, setStage] = useState(-1);
  const [demoIn, setDemoIn] = useState(false);
  const [success, setSuccess] = useState(false);
  const [outro, setOutro] = useState(false);
  const [hasOutro, setHasOutro] = useState(false);
  const [outroFade, setOutroFade] = useState(false);
  const [shake, setShake] = useState(false);
  const outroRef = useRef(null);
  const dustRef = useRef(null);
  const sceneRef = useRef(null);
  const departHref = useRef('/');

  useEffect(() => {
    try { sessionStorage.removeItem('maruti_demo'); sessionStorage.removeItem('maruti_demo_admin'); } catch {}
    try { const saved = localStorage.getItem('maruti_login_email'); if (saved) { setEmail(saved); setRemember(true); } } catch {}
    fetch('/outro.mp4', { method: 'HEAD' }).then((r) => setHasOutro(r.ok)).catch(() => setHasOutro(false));
  }, []);

  const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (reduced()) { setStage(ORDER.length - 1); setDemoIn(true); return; }
    setStage(0);
  }, []);
  useEffect(() => {
    if (stage < 0 || stage >= ORDER.length - 1) return undefined;
    const gaps = { card: 750, logo: 380, name: 160, email: 90, password: 90, meta: 300 };
    const t = setTimeout(() => setStage((s) => s + 1), gaps[ORDER[stage]] ?? 120);
    return () => clearTimeout(t);
  }, [stage]);
  useEffect(() => {
    if (stage >= ORDER.length - 1 && !reduced()) { const t = setTimeout(() => setDemoIn(true), 900); return () => clearTimeout(t); }
    return undefined;
  }, [stage]);
  const on = (k) => stage >= ORDER.indexOf(k);

  // ambient dust, brighter toward the warm interior light
  useEffect(() => {
    if (stage < 0 || reduced()) return undefined;
    const c = dustRef.current; if (!c) return undefined;
    const ctx = c.getContext('2d');
    let raf, W, H;
    const fit = () => { W = c.width = c.offsetWidth; H = c.height = c.offsetHeight; };
    fit(); window.addEventListener('resize', fit);
    const motes = Array.from({ length: 34 }, () => {
      const d = Math.random();
      return { x: Math.random(), y: Math.random(), d, r: 0.4 + d * 1.7, vx: (Math.random() - 0.4) * 0.00005 * (0.4 + d), vy: -(0.00004 + Math.random() * 0.00008) * (0.4 + d), a: 0.05 + d * 0.2 };
    });
    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      motes.forEach((p) => {
        p.x += p.vx; p.y += p.vy;
        if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
        if (p.x > 1.02) p.x = -0.02; if (p.x < -0.02) p.x = 1.02;
        const cone = Math.max(0, 1 - (Math.hypot(p.x - 0.55, p.y - 0.2) / 0.8));
        ctx.beginPath(); ctx.arc(p.x * W, p.y * H, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(232,200,144,${p.a * (0.35 + cone * 0.65)})`; ctx.fill();
      });
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', fit); };
  }, [stage]);

  // pointer parallax on the scene image
  useEffect(() => {
    if (reduced()) return undefined;
    const el = sceneRef.current; if (!el) return undefined;
    const move = (e) => {
      el.style.setProperty('--px', (e.clientX / window.innerWidth - 0.5).toFixed(4));
      el.style.setProperty('--py', (e.clientY / window.innerHeight - 0.5).toFixed(4));
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    if (!email || !password) { toast.error('Enter your email and password', { id: 'login-error' }); return; }
    try { remember ? localStorage.setItem('maruti_login_email', email.trim()) : localStorage.removeItem('maruti_login_email'); } catch (e) { console.error('[login] could not save email', e); }

    // SESSION PERSISTENCE. No setPersistence() call existed, so Firebase defaulted to
    // browserLocalPersistence and EVERY login persisted forever — including on a shared
    // workshop counter PC where the user did not tick "remember me". Honour the choice:
    //   remember  -> survives a browser restart (the owner's own laptop)
    //   otherwise -> dies with the tab (the shared counter terminal)
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
      setShake(true); setTimeout(() => setShake(false), 420);
      const msg = err.code === 'auth/invalid-credential' ? 'Wrong email or password'
        : err.code === 'auth/too-many-requests' ? 'Too many attempts. Try again later.'
        : 'Login failed. Check your connection.';
      toast.error(msg, { id: 'login-error' });
    }
  }

  // Phase 2 → 3–5 → 6: success card → outro film → real dashboard in the smoke.
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
    setEnteringDemo(true);
    try { sessionStorage.setItem('maruti_demo', '1'); sessionStorage.removeItem('maruti_demo_admin'); } catch {}
    depart('/?demo=1');
  }

  const rv = (k, extra = '') => `rv ${on(k) ? 'rv-on' : ''} ${extra}`;
  const font = { fontFamily: 'Inter, Montserrat, system-ui, sans-serif' };

  return (
    <>
      <Head><title>Sign in — Sri Baba Balaji Maruti Care</title></Head>

      <div ref={sceneRef} className="scene min-h-screen relative overflow-hidden flex items-center justify-center md:justify-end p-4 md:pr-[6vw]" style={{ ...font, paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        {/* full-bleed photoreal workshop (car parked) — no CSS silhouettes */}
        <div className="lyr absolute inset-0">
          <img src="/login-scene.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: '32% center' }} />
          <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 120% 95% at 40% 45%, transparent 55%, rgba(0,0,0,0.5) 100%)' }} />
        </div>
        <canvas ref={dustRef} className="absolute inset-0 pointer-events-none" />

        {/* ---- floating glass card (storyboard panel 1) ---- */}
        <div className={`card ${on('card') ? 'card-on' : ''} ${shake ? 'card-shake' : ''} relative w-full max-w-[390px] rounded-2xl px-6 sm:px-8 pt-7 sm:pt-8 pb-6 max-h-[94vh] overflow-y-auto dark-scroll`}>
          <span aria-hidden className="reflect absolute inset-0 rounded-2xl pointer-events-none" />

          <div className={rv('logo', 'flex justify-center mb-4')}>
            <div className="relative">
              <img src="/icons/icon-512.png" alt="" className="w-20 h-20 rounded-full object-contain" style={{ border: '2px solid rgba(212,175,55,0.55)', boxShadow: '0 0 24px rgba(212,175,55,0.18)' }} />
              <span aria-hidden className="logoSheen rounded-full" />
            </div>
          </div>
          <div className={rv('name', 'text-center mb-7')}>
            <p style={{ color: '#e9c766', fontSize: 15, letterSpacing: '0.14em', fontWeight: 700 }}>SRI BABA BALAJI MARUTI CARE</p>
            <p style={{ color: 'rgba(210,205,192,0.5)', fontSize: 11, marginTop: 4 }}>Sign in to the workshop system</p>
          </div>

          <form onSubmit={handleLogin}>
            <div className={rv('email', 'mb-4')}>
              <label className="fieldLabel">Email</label>
              <div className="relative">
                <svg className="fieldIcon" width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M3.5 7l8.5 6 8.5-6" stroke="currentColor" strokeWidth="1.6"/></svg>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="owner@balaji.com" className="field pl-10" />
              </div>
            </div>
            <div className={rv('password', 'mb-3')}>
              <label className="fieldLabel">Password</label>
              <div className="relative">
                <svg className="fieldIcon" width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M8 10V7a4 4 0 118 0v3" stroke="currentColor" strokeWidth="1.6"/></svg>
                <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="••••••••" className="field pl-10 pr-10" />
                <button type="button" aria-label="Show password" onClick={() => setShowPw((s) => !s)} className="pwToggle">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" stroke="currentColor" strokeWidth="1.5"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.5"/></svg>
                </button>
              </div>
            </div>
            <div className={rv('meta', 'flex items-center justify-between mb-6')}>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-[#d4af37] w-3.5 h-3.5" />
                <span style={{ fontSize: 11, color: 'rgba(210,205,192,0.6)' }}>Remember me</span>
              </label>
              <button type="button" className="hover:underline" style={{ fontSize: 11, color: 'rgba(233,199,102,0.8)' }}
                onClick={async () => {
                  if (!email) { toast.error('Enter your email first, then tap reset.'); return; }
                  try { await sendPasswordResetEmail(auth, email); toast.success('Password reset link sent — check your email.'); }
                  catch (err) { toast.error(err?.code === 'auth/user-not-found' ? 'No account with that email.' : 'Could not send reset email.'); }
                }}>Forgot password?</button>
            </div>
            <button type="submit" disabled={loading} className={rv('primary', 'goldBtn w-full py-3.5 rounded-xl font-bold flex items-center justify-center gap-2')} style={{ fontSize: 14, letterSpacing: '0.16em' }}>
              {loading ? <span className="btnProgress w-full" aria-label="Signing in" /> : (<>
                ENTER WORKSHOP
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 12h15M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </>)}
            </button>
          </form>

          <div className={`demo ${demoIn ? 'demo-on' : ''}`}>
            <div className="flex items-center gap-3 my-5">
              <span className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.1)' }} />
              <span style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(210,205,192,0.4)' }}>OR</span>
              <span className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.1)' }} />
            </div>
            <div className="flex items-start gap-3 rounded-xl p-3 mb-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <svg className="flex-shrink-0 mt-0.5" width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ color: 'rgba(233,199,102,0.85)' }}><rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M9 21h6M12 17v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              <p style={{ fontSize: 11, color: 'rgba(210,205,192,0.6)', lineHeight: 1.55 }}>Explore the full system in a demo workspace.<br />No account needed · Resets automatically</p>
            </div>
            <button type="button" disabled={enteringDemo} onClick={launchDemo} className="demoBtn w-full py-3 rounded-xl font-bold" style={{ fontSize: 12.5, letterSpacing: '0.14em' }}>
              {enteringDemo ? 'ENTERING…' : 'LAUNCH INTERACTIVE DEMO'}
            </button>
            <p className="text-center mt-5" style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(210,205,192,0.28)' }}>SBB MARUTI CARE · GAJUWAKA · EST. 1998</p>
          </div>
        </div>

        {/* Phase 2 — success card */}
        {success && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center" style={{ background: 'rgba(8,8,9,0.35)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)' }}>
            <div className="successCard rounded-2xl px-10 py-8 text-center" style={{ background: 'linear-gradient(200deg, rgba(28,29,33,0.92), rgba(15,16,18,0.95))', border: '1px solid rgba(212,175,55,0.35)', boxShadow: '0 30px 80px rgba(0,0,0,0.6)' }}>
              <span className="successTick mx-auto mb-4 flex items-center justify-center w-12 h-12 rounded-full" style={{ border: '2px solid #d4af37' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.2 4.2L19 7" stroke="#d4af37" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <p style={{ color: '#ece8dd', fontSize: 16, fontWeight: 600 }}>Login Successful</p>
              <p style={{ color: 'rgba(200,195,182,0.5)', fontSize: 11.5, marginTop: 5 }}>Loading Garage Management ERP…</p>
              <span className="block mt-5 h-[3px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)', width: 220 }}>
                <span className="successFill block h-full" style={{ background: 'linear-gradient(90deg,#d4af37,#e8c96a)' }} />
              </span>
            </div>
          </div>
        )}

        {/* Phases 3–5 — outro film; Phase 6 — real dashboard in the clearing smoke */}
        {outro && (
          <div className={`fixed inset-0 z-[140] bg-black transition-opacity duration-500 ${outroFade ? 'opacity-0' : 'opacity-100'}`}>
            <video ref={outroRef} src="/outro.mp4" autoPlay muted playsInline className="w-full h-full object-cover"
              onTimeUpdate={onOutroTime}
              onEnded={() => { window.location.href = departHref.current; }}
              onError={() => { window.location.href = departHref.current; }} />
          </div>
        )}

        <style jsx>{`
          .scene { background: #070606; }
          .lyr { will-change: transform; transform: translate(calc(var(--px,0)*-12px), calc(var(--py,0)*-8px)) scale(1.03); transition: transform .25s ease-out; animation: dolly 40s ease-in-out infinite alternate; }
          @keyframes dolly { from { scale: 1.0; } to { scale: 1.03; } }

          .card { opacity: 0; transform: translateY(16px) scale(0.985); filter: blur(6px);
            background: linear-gradient(200deg, rgba(22,21,19,0.78), rgba(12,12,11,0.85));
            border: 1px solid rgba(212,175,55,0.35);
            box-shadow: 0 30px 90px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 46px rgba(212,175,55,0.07);
            backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
            transition: opacity .8s ease, transform .8s ease, filter .8s ease; }
          .card-on { opacity: 1; transform: none; filter: none; }
          .card-shake { animation: shake .42s ease; }
          @keyframes shake { 20%{transform:translateX(-2px)} 45%{transform:translateX(2px)} 70%{transform:translateX(-1px)} 100%{transform:none} }

          .reflect { background: linear-gradient(115deg, transparent 44%, rgba(255,255,255,0.05) 50%, transparent 56%); background-size: 300% 100%; animation: traverse 30s linear infinite; }
          @keyframes traverse { from { background-position: 140% 0; } to { background-position: -140% 0; } }

          .rv { opacity: 0; transform: translateY(9px); transition: opacity .45s ease, transform .45s ease; }
          .rv-on { opacity: 1; transform: none; }
          .logoSheen { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(110deg, transparent 34%, rgba(255,240,200,0.22) 50%, transparent 66%); background-size: 240% 100%; animation: sheen 1.9s ease-out .3s 1 both; }
          @keyframes sheen { from { background-position: 135% 0; } to { background-position: -55% 0; opacity: 0; } }

          :global(.fieldLabel) { display:block; font-size:10.5px; letter-spacing:0.14em; color: rgba(210,205,192,0.5); margin-bottom: 6px; text-transform: uppercase; }
          :global(.fieldIcon) { position:absolute; left: 12px; top: 50%; transform: translateY(-50%); color: rgba(210,205,192,0.4); pointer-events: none; }
          :global(.pwToggle) { position:absolute; right: 10px; top: 50%; transform: translateY(-50%); color: rgba(210,205,192,0.45); }
          :global(.field) { width:100%; padding: 11px 13px; border-radius: 10px; font-size: 14px; outline: none; color:#ece8dd;
            background: rgba(8,8,9,0.55); border: 1px solid rgba(255,255,255,0.1);
            transition: border-color .16s ease, box-shadow .16s ease; }
          :global(.field:focus) { border-color: rgba(212,175,55,0.6); box-shadow: 0 0 0 3px rgba(212,175,55,0.1); }
          :global(.field::placeholder) { color: rgba(200,195,182,0.25); }
          /* keep autofill dark (Chrome paints these white otherwise) */
          :global(.field:-webkit-autofill),
          :global(.field:-webkit-autofill:hover),
          :global(.field:-webkit-autofill:focus) {
            -webkit-box-shadow: 0 0 0 1000px #121110 inset !important;
            -webkit-text-fill-color: #ece8dd !important;
            caret-color: #ece8dd;
            border: 1px solid rgba(255,255,255,0.1);
            transition: background-color 999999s ease-in-out 0s;
          }

          .goldBtn { background: linear-gradient(90deg,#d4af37,#b8912c); color:#141310; box-shadow: 0 8px 26px rgba(212,175,55,0.22); transition: box-shadow .16s ease, transform .12s ease; }
          .goldBtn:hover { box-shadow: 0 10px 32px rgba(212,175,55,0.3); }
          .goldBtn:active { transform: scale(0.985); }
          .btnProgress { display:block; height: 17px; background: linear-gradient(90deg, transparent, rgba(20,19,16,0.55), transparent); background-size: 40% 100%; background-repeat: no-repeat; animation: prog 1.1s ease-in-out infinite; }
          @keyframes prog { from { background-position: -40% 0; } to { background-position: 140% 0; } }

          .demoBtn { background: transparent; border: 1px solid rgba(212,175,55,0.4); color: rgba(233,199,102,0.85); transition: border-color .16s ease, background .16s ease; }
          .demoBtn:hover { border-color: rgba(212,175,55,0.7); background: rgba(212,175,55,0.06); }
          .demo { opacity: 0; transition: opacity .8s ease; }
          .demo-on { opacity: 1; }

          .successCard { animation: cardIn .3s ease both; }
          @keyframes cardIn { from { opacity: 0; transform: scale(0.96) translateY(6px); } to { opacity: 1; transform: none; } }
          .successTick { animation: tickPop .35s ease .1s both; }
          @keyframes tickPop { from { transform: scale(0.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
          .successFill { width: 0; animation: fillGold .7s ease .12s forwards; }
          @keyframes fillGold { to { width: 100%; } }

          @media (prefers-reduced-motion: reduce) {
            .lyr { animation: none; }
            .reflect, .logoSheen { display: none; }
            .rv, .card, .demo { transition: none; opacity: 1; transform: none; filter: none; }
          }
          /* Mobile recomposition: workshop fills screen, car stays in the hero,
             card centered with comfortable touch spacing. */
          @media (max-width: 767px) {
            .lyr :global(img) { object-position: 24% center !important; }
            .card { backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
          }
          /* Short landscape phones/laptops: card scrolls internally, never clips */
          @media (max-height: 640px) {
            .card { max-height: 96vh; }
          }
        `}</style>
      </div>
    </>
  );
}
