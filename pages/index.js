// pages/index.js
import Head from 'next/head';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../context/AuthContext';
import InventoryDashboard from '../components/InventoryDashboard';
import BootSplash from '../components/common/BootSplash';
import { auth, signOut } from '../lib/firebase';
import { startIdleWatch, clearBusinessCaches } from '../lib/session';

export default function Home() {
  const router = useRouter();
  const { user, loading, demoMode } = useAuth();

  useEffect(() => {
    if (!loading && !user && !demoMode) router.push('/login');
  }, [user, loading, demoMode, router]);

  // IDLE TIMEOUT. Firebase's default persistence never expires on the client, so a
  // workshop terminal left on the shop floor stays signed in indefinitely — anyone
  // walking past can raise invoices or read customer phone numbers. Expire the session
  // after a full working day of no interaction, and clear the cached business data on
  // the way out so the next person cannot read it from localStorage.
  useEffect(() => {
    if (!user || demoMode) return undefined;
    return startIdleWatch(async () => {
      try { await signOut(auth); } catch (e) { console.error('[auth] idle sign-out failed', e); }
      clearBusinessCaches();
      router.push('/login?expired=1');
    });
  }, [user, demoMode, router]);

  if (loading) return <BootSplash />;

  if (!user && !demoMode) return <BootSplash label="Redirecting…" />;

  return (
    <>
      <Head>
        <title>Inventory — Sri Baba Balaji Maruti Care</title>
        {/* Viewport is set once in _app.js. It must NOT be redefined here:
            `maximum-scale=1` blocked pinch-zoom, which fails WCAG 1.4.4 and makes the
            app unusable for older workshop owners who zoom to read part numbers. */}
      </Head>
      <InventoryDashboard />
    </>
  );
}
