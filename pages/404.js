// A mistyped or stale URL previously fell through to Next.js's unstyled default page,
// which looks like a broken deployment to a workshop owner. This keeps them inside the
// product and gives them one obvious way back.
import Head from 'next/head';
import Link from 'next/link';

export default function NotFound() {
  return (
    <>
      <Head><title>Page not found — Sri Baba Balaji Maruti Care</title></Head>
      <main
        style={{
          minHeight: '100dvh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24,
          background: '#0d0d0d', color: '#e5e5e5', textAlign: 'center',
          fontFamily: 'Montserrat, system-ui, sans-serif',
        }}
      >
        <p style={{ fontSize: 56, fontWeight: 700, color: '#d4af37', margin: 0, fontFamily: 'Cinzel, serif' }}>404</p>
        <h1 style={{ fontSize: 18, margin: 0, fontWeight: 600 }}>This page doesn’t exist</h1>
        <p style={{ fontSize: 13, color: 'rgba(229,229,229,0.55)', margin: 0, maxWidth: 380 }}>
          The link may be out of date. Everything in the workshop app lives on the dashboard.
        </p>
        <Link
          href="/"
          style={{
            marginTop: 8, padding: '10px 20px', borderRadius: 12, fontSize: 13, fontWeight: 700,
            color: '#111', background: 'linear-gradient(90deg,#d4af37,#aa801e)', textDecoration: 'none',
          }}
        >
          Back to dashboard
        </Link>
      </main>
    </>
  );
}
