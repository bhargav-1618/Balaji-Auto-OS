// components/common/BootSplash.jsx — branded loading screen shown during the
// auth/boot gap so there's never a white flash or blank frame after login.
import React from 'react';

export default function BootSplash({ label = 'Loading your workshop…' }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(120% 120% at 50% 0%, #141110 0%, #0a0a0a 60%)', fontFamily: 'Montserrat, system-ui, sans-serif' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        <div style={{ width: 76, height: 76, borderRadius: 18, overflow: 'hidden', background: 'linear-gradient(135deg,#e8c84a,#aa801e)', boxShadow: '0 8px 40px rgba(212,175,55,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="boot-logo">
          <img src="/icons/icon-512.png" alt="Sri Baba Balaji Maruti Care" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 2, color: '#d4af37' }}>SRI BABA BALAJI</div>
          <div style={{ fontSize: 10, letterSpacing: 3, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>MARUTI CARE</div>
        </div>
        <div style={{ width: 140, height: 3, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          <div className="boot-bar" style={{ height: '100%', width: '40%', borderRadius: 3, background: 'linear-gradient(90deg,#e8c84a,#aa801e)' }} />
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{label}</div>
      </div>
      <style>{`
        @keyframes bootbar { 0% { transform: translateX(-140%); } 100% { transform: translateX(360%); } }
        .boot-bar { animation: bootbar 1.1s ease-in-out infinite; }
        @keyframes bootpulse { 0%,100% { transform: scale(1); box-shadow: 0 8px 40px rgba(212,175,55,0.22); } 50% { transform: scale(1.04); box-shadow: 0 10px 52px rgba(212,175,55,0.38); } }
        .boot-logo { animation: bootpulse 1.8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .boot-bar, .boot-logo { animation: none; } }
      `}</style>
    </div>
  );
}
