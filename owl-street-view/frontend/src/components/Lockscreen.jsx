import React, { useState } from 'react';

export default function Lockscreen({ onUnlock, theme, onToggleTheme }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (res.ok) {
        onUnlock();
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.detail || 'Invalid Password');
      }
    } catch (e) {
      setError('Connection failed');
    }
  };

  return (
    <div style={styles.overlay}>
      <button 
        type="button" 
        onClick={onToggleTheme} 
        style={styles.themeToggle}
        title="Toggle Theme"
      >
        {theme === 'dark' ? (
          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 18, height: 18 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
          </svg>
        ) : (
          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 18, height: 18 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
          </svg>
        )}
      </button>

      <div style={styles.card}>
        <div style={styles.logoContainer}>
          <div style={styles.logoIcon}>
            <svg fill="none" stroke="#fff" strokeWidth="2.5" viewBox="0 0 24 24" style={{ width: 20, height: 20 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <div style={styles.logoText}>Owl Street View</div>
        </div>
        <p style={styles.subtitle}>Enter password to unlock trading dashboard</p>
        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            placeholder="••••••••"
            autoFocus
          />
          <button type="submit" style={styles.button}>Unlock Dashboard</button>
        </form>
        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.dividerContainer}>
          <div style={styles.dividerLine}></div>
          <span style={styles.dividerText}>Or Sign In With</span>
          <div style={styles.dividerLine}></div>
        </div>

        <div style={styles.ssoContainer}>
          <button 
            type="button" 
            onClick={() => window.location.href = '/api/auth/google/login'} 
            style={styles.googleButton}
          >
            <svg viewBox="0 0 24 24" style={{ width: 18, height: 18 }} xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
            </svg>
            Google
          </button>

        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    background: 'var(--bg-app)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeToggle: {
    position: 'absolute',
    top: 20,
    right: 20,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    width: 40,
    height: 40,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    zIndex: 10000,
    boxShadow: 'var(--shadow-soft)',
    outline: 'none',
    transition: 'all 0.2s',
  },
  card: {
    background: 'var(--bg-surface)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid var(--border)',
    borderRadius: 20,
    width: 380,
    padding: 40,
    textAlign: 'center',
    boxShadow: 'var(--shadow-card)',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  logoContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    justifyContent: 'center',
  },
  logoIcon: {
    width: 36,
    height: 36,
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
  },
  logoText: {
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: '-0.5px',
    background: 'linear-gradient(135deg, var(--text-primary), var(--text-secondary))',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    color: 'var(--text-secondary)',
    fontSize: 14,
    margin: 0,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  input: {
    width: '100%',
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '12px 16px',
    color: 'var(--text-primary)',
    fontSize: 14,
    outline: 'none',
    textAlign: 'center',
    transition: 'border-color 0.2s',
  },
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 18px',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid transparent',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#fff',
    boxShadow: '0 4px 14px rgba(99, 102, 241, 0.25)',
    justifyContent: 'center',
    transition: 'all 0.2s',
  },
  error: {
    color: 'var(--danger)',
    fontSize: 13,
    margin: 0,
  },
  dividerContainer: {
    margin: '16px 0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dividerLine: {
    flexGrow: 1,
    height: 1,
    background: 'var(--border)',
  },
  dividerText: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  ssoContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  googleButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 18px',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    boxShadow: 'var(--shadow-soft)',
    justifyContent: 'center',
    transition: 'all 0.2s',
  },
};
