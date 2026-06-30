// pages/index.js
import Head from 'next/head';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../context/AuthContext';
import InventoryDashboard from '../components/InventoryDashboard';

export default function Home() {
  const router = useRouter();
  const { user, loading, demoMode } = useAuth();

  useEffect(() => {
    if (!loading && !user && !demoMode) router.push('/login');
  }, [user, loading, demoMode, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a0a' }}>
        <div className="text-sm" style={{ color: '#d4af37' }}>Loading…</div>
      </div>
    );
  }

  if (!user && !demoMode) return null;

  return (
    <>
      <Head>
        <title>Inventory — Sri Baba Balaji Maruti Care</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Head>
      <InventoryDashboard />
    </>
  );
}
