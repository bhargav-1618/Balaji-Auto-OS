// pages/login.js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { auth, signInWithEmailAndPassword, sendPasswordResetEmail } from '../lib/firebase';
import toast from 'react-hot-toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [enteringDemo, setEnteringDemo] = useState(false);
  const router = useRouter();

  // If you're on the login page, you are NOT in a demo session. Clear any leftover
  // demo flags so a subsequent production login never drops you back into demo.
  useEffect(() => {
    try { sessionStorage.removeItem('maruti_demo'); sessionStorage.removeItem('maruti_demo_admin'); } catch {}
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Enter your email and password', { id: 'login-error' });
      return;
    }
    // Demo USER credentials are intercepted here (no Firebase account needed) and
    // route into the isolated in-memory demo. Demo Admin is NOT reachable from the
    // public login — it is entered by a Production Admin via Settings.
    const em = email.trim().toLowerCase();
    if (em === 'demo@balajiautoos.com' && password === 'Demo@123') {
      try { sessionStorage.setItem('maruti_demo', '1'); sessionStorage.removeItem('maruti_demo_admin'); } catch {}
      window.location.href = '/?demo=1';
      return;
    }
    setLoading(true);
    try {
      // Ensure no demo state survives into a real production session.
      try { sessionStorage.removeItem('maruti_demo'); sessionStorage.removeItem('maruti_demo_admin'); } catch {}
      await signInWithEmailAndPassword(auth, email, password);
      window.location.href = '/'; // hard load => AuthContext re-inits with no demo flags
    } catch (err) {
      const msg = err.code === 'auth/invalid-credential'
        ? 'Wrong email or password'
        : err.code === 'auth/too-many-requests'
        ? 'Too many attempts. Try again later.'
        : 'Login failed. Check your connection.';
      toast.error(msg, { id: 'login-error' }); // fixed id => never stacks duplicates
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Login — Sri Baba Balaji Maruti Care</title>
      </Head>
      <div className="min-h-screen bg-carbon-900 flex items-center justify-center p-4">
        {/* Background grid pattern */}
        <div
          className="fixed inset-0 opacity-5 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(212,175,55,0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(212,175,55,0.3) 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
          }}
        />

        <div className="relative w-full max-w-sm">
          {/* Logo card */}
          <div
            className="rounded-2xl p-8"
            style={{
              background: 'linear-gradient(145deg, #1a1a1a, #222222)',
              border: '1px solid rgba(212,175,55,0.25)',
              boxShadow: '0 25px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(212,175,55,0.1)',
            }}
          >
            {/* Logo */}
            <div className="flex justify-center mb-6">
              <img
                src="/icons/icon-512.png"
                alt="Sri Baba Balaji Maruti Care"
                className="w-32 h-32 rounded-2xl object-contain"
                style={{ border: '1px solid rgba(212,175,55,0.25)' }}
              />
            </div>

            {/* Title */}
            <h1
              className="text-center text-xl mb-1 tracking-widest"
              style={{ fontFamily: 'Cinzel, serif', color: '#d4af37' }}
            >
              Sri Baba Balaji
            </h1>
            <p
              className="text-center text-xs mb-1 tracking-widest"
              style={{ fontFamily: 'Cinzel, serif', color: '#d4af37' }}
            >
              Maruti Care
            </p>
            <p className="text-center text-xs text-gray-500 mb-8 tracking-widest uppercase">
              Gajuwaka · Est. 1998
            </p>

            {/* Form */}
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-2 uppercase tracking-wider">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@balaji.com"
                  autoComplete="email"
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
                  style={{
                    background: '#111111',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#e5e5e5',
                    fontFamily: 'Montserrat, sans-serif',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = 'rgba(212,175,55,0.5)')}
                  onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.08)')}
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-2 uppercase tracking-wider">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
                  style={{
                    background: '#111111',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#e5e5e5',
                    fontFamily: 'Montserrat, sans-serif',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = 'rgba(212,175,55,0.5)')}
                  onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.08)')}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl font-semibold text-sm tracking-wider transition-all active:scale-95 touch-target"
                style={{
                  background: loading ? 'rgba(212,175,55,0.5)' : '#d4af37',
                  color: '#111111',
                  fontFamily: 'Montserrat, sans-serif',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Signing in...' : 'Enter Workshop'}
              </button>
            </form>

            <p className="text-center text-xs text-gray-600 mt-6">
              <button
                type="button"
                onClick={async () => {
                  if (!email) {
                    toast.error('Enter your email above first, then tap reset.');
                    return;
                  }
                  try {
                    await sendPasswordResetEmail(auth, email);
                    toast.success('Password reset link sent — check your email.');
                  } catch (err) {
                    toast.error(err?.code === 'auth/user-not-found' ? 'No account with that email.' : 'Could not send reset email.');
                  }
                }}
                className="text-[#d4af37] hover:underline"
              >
                Forgot password? Email me a reset link
              </button>
            </p>

            {/* Public demo access — Demo USER only. Demo Admin is never exposed
                here; it is entered by a Production Admin via Settings → Demo
                Management. Routes to an isolated in-memory sandbox. */}
            <div className="mt-5 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="rounded-xl p-4" style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.25)' }}>
                <div className="text-sm font-bold text-[#d4af37]">🚀 Try Interactive Demo</div>
                <p className="text-[11px] text-white/50 mt-1 mb-3">Explore sample inventory, suppliers, sales and reports. Changes reset automatically.</p>
                <button
                  type="button"
                  disabled={enteringDemo}
                  onClick={() => {
                    setEnteringDemo(true);
                    try { sessionStorage.setItem('maruti_demo', '1'); sessionStorage.removeItem('maruti_demo_admin'); } catch {}
                    window.location.href = '/?demo=1';
                  }}
                  className="w-full py-3 rounded-xl text-sm font-bold transition active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                  style={{ background: 'linear-gradient(90deg,#d4af37,#aa801e)', color: '#1a1a1a' }}
                >
                  {enteringDemo ? (
                    <>
                      <span className="inline-block w-4 h-4 border-2 border-[#1a1a1a]/40 border-t-[#1a1a1a] rounded-full animate-spin" />
                      Entering Demo…
                    </>
                  ) : 'Enter Demo'}
                </button>
                <div className="flex items-center justify-center gap-1.5 mt-2.5">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-white/45 px-2 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    🔒 Safe demo environment · No signup required
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
