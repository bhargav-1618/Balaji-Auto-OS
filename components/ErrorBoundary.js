// components/ErrorBoundary.js
// Production safety net: if any descendant throws during render, React unmounts
// the whole tree and the user sees a blank white screen with no way back. This
// boundary catches that, logs it, and shows a branded recovery card with a
// reload action so the shop is never stranded on a dead page.
import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Something went wrong.' };
  }

  componentDidCatch(error, info) {
    // Keep this on console.error (not console.log) so it surfaces in the
    // browser's error channel and any future error-reporting hook can attach here.
    console.error('App crashed (caught by ErrorBoundary):', error, info?.componentStack);
  }

  handleReload = () => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#0a0a0a',
          color: '#e5e5e5',
          fontFamily: 'Montserrat, system-ui, sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: 440,
            width: '100%',
            textAlign: 'center',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(212,175,55,0.25)',
            borderRadius: 16,
            padding: '32px 24px',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              margin: '0 auto 16px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(212,175,55,0.12)',
              border: '1px solid rgba(212,175,55,0.4)',
              fontSize: 26,
            }}
            aria-hidden="true"
          >
            ⚠️
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 8px' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', margin: '0 0 20px', lineHeight: 1.5 }}>
            The app hit an unexpected error and stopped to protect your data. Your
            saved inventory is safe. Reload to continue.
          </p>
          <button
            onClick={this.handleReload}
            style={{
              cursor: 'pointer',
              padding: '10px 22px',
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 14,
              color: '#0a0a0a',
              background: 'linear-gradient(90deg, #d4af37, #aa801e)',
              border: 'none',
            }}
          >
            Reload app
          </button>
          {this.state.message && (
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 16, wordBreak: 'break-word' }}>
              {this.state.message}
            </p>
          )}
        </div>
      </div>
    );
  }
}
