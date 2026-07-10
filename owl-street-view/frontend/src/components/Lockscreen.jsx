import React, { useState } from 'react';

export default function Lockscreen({ onUnlock }) {
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
    background: '#0b0f19',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    background: 'rgba(17, 24, 39, 0.85)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: 20,
    width: 380,
    padding: 40,
    textAlign: 'center',
    boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
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
    background: 'linear-gradient(135deg, #fff, #9ca3af)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    color: '#9ca3af',
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
    background: 'rgba(0, 0, 0, 0.2)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: 10,
    padding: '12px 16px',
    color: '#fff',
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
    color: '#ef4444',
    fontSize: 13,
    margin: 0,
  }
};
