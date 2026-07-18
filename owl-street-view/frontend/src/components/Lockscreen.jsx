import React, { useState, useEffect } from 'react';

// Decodes JWT token locally to retrieve payload values (like email) without backend dependency.
const decodeJwt = (token) => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
};

export default function Lockscreen({ onUnlock, googleEnabled, googleClientId, templeEnabled, microsoftEnabled, microsoftClientId, passwordEnabled = true }) {
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

  const handleGoogleLogin = async () => {
    setError('');
    const email = prompt("Enter Google Mock Email:", "test@gmail.com");
    if (!email) return;
    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, provider: 'google' })
      });
      if (res.ok) {
        onUnlock();
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.detail || 'Simulated Google Auth failed');
      }
    } catch (e) {
      setError('Connection failed');
    }
  };

  const handleTempleLogin = () => {
    window.location.href = '/api/auth/temple/login';
  };

  const handleMicrosoftLogin = async () => {
    setError('');
    try {
      const { PublicClientApplication } = await import("@azure/msal-browser");
      
      const msalConfig = {
        auth: {
          clientId: microsoftClientId || "mock",
          authority: "https://login.microsoftonline.com/common",
          redirectUri: window.location.origin
        },
        cache: {
          cacheLocation: "sessionStorage",
          storeAuthStateInCookie: false
        }
      };
      
      if (microsoftClientId === "mock") {
        const email = prompt("Enter Microsoft Mock Email:", "test@gmail.com");
        if (!email) return;
        const res = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, provider: 'microsoft' })
        });
        if (res.ok) {
          onUnlock();
        } else {
          const err = await res.json().catch(() => ({}));
          setError(err.detail || 'Simulated Microsoft Auth failed');
        }
        return;
      }
      
      const msalInstance = new PublicClientApplication(msalConfig);
      await msalInstance.initialize();
      
      const loginResponse = await msalInstance.loginPopup({
        scopes: ["user.read", "openid", "profile"]
      });
      
      const email = loginResponse.account?.username;
      if (!email) {
        setError('Failed to extract email from Microsoft account');
        return;
      }
      
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, provider: 'microsoft' })
      });
      
      if (res.ok) {
        onUnlock();
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.detail || 'Microsoft authentication failed');
      }
      
    } catch (err) {
      console.error("Microsoft login error:", err);
      setError(err.message || 'Microsoft login failed');
    }
  };

  /* global google */
  useEffect(() => {
    if (googleEnabled && googleClientId && googleClientId !== "mock" && window.google) {
      try {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          ux_mode: 'popup',
          callback: async (response) => {
            setError('');
            try {
              const payload = decodeJwt(response.credential);
              const email = payload?.email;
              if (!email) {
                setError('Failed to extract email from Google token');
                return;
              }
              
              const res = await fetch('/api/auth/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, provider: 'google' })
              });
              
              if (res.ok) {
                onUnlock();
              } else {
                const err = await res.json().catch(() => ({}));
                setError(err.detail || 'Google authentication failed');
              }
            } catch (e) {
              setError('Connection failed');
            }
          }
        });
        
        window.google.accounts.id.renderButton(
          document.getElementById("google-gsi-btn"),
          { 
            theme: "outline", 
            size: "large",
            text: "signin_with",
            shape: "rectangular",
            width: 320
          }
        );
      } catch (err) {
        console.error("Failed to initialize Google Identity Services:", err);
      }
    }
  }, [googleEnabled, googleClientId]);

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
        
        <p style={styles.subtitle}>
          {passwordEnabled 
            ? 'Enter password or sign in using SSO to unlock trading dashboard' 
            : 'Sign in using SSO to unlock trading dashboard'}
        </p>

        {passwordEnabled && (
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
        )}

        {passwordEnabled && (googleEnabled || templeEnabled || microsoftEnabled) && (
          <div style={styles.divider}>
            <span style={styles.dividerLine}></span>
            <span style={styles.dividerText}>or</span>
            <span style={styles.dividerLine}></span>
          </div>
        )}

        {(googleEnabled || templeEnabled || microsoftEnabled) && (
          <div style={styles.ssoContainer}>
            {googleEnabled && googleClientId === "mock" && (
              <button onClick={handleGoogleLogin} style={styles.googleButton}>
                <svg viewBox="0 0 24 24" width="18" height="18" style={{ marginRight: 4 }}>
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                Sign in with Google
              </button>
            )}
            {googleEnabled && googleClientId !== "mock" && (
              <div id="google-gsi-btn" style={{ display: 'flex', justifyContent: 'center', width: '100%', minHeight: 44 }}></div>
            )}
            {microsoftEnabled && (
              <button onClick={handleMicrosoftLogin} style={styles.microsoftButton}>
                <svg viewBox="0 0 23 23" width="18" height="18" style={{ marginRight: 8 }}>
                  <rect x="0" y="0" width="10" height="10" fill="#f25022" />
                  <rect x="11" y="0" width="10" height="10" fill="#7fba00" />
                  <rect x="0" y="11" width="10" height="10" fill="#00a4ef" />
                  <rect x="11" y="11" width="10" height="10" fill="#ffb900" />
                </svg>
                Sign in with Microsoft
              </button>
            )}
            {templeEnabled && (
              <button onClick={handleTempleLogin} style={styles.templeButton}>
                <span style={styles.templeIcon}>T</span>
                Sign in with Temple SSO
              </button>
            )}
          </div>
        )}

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
    padding: '40px 30px',
    textAlign: 'center',
    boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
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
    lineHeight: '1.4',
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
    padding: '12px 18px',
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
  divider: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    margin: '4px 0',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: 'rgba(255, 255, 255, 0.08)',
  },
  dividerText: {
    color: '#4b5563',
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  ssoContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  googleButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '12px 18px',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    background: '#ffffff',
    color: '#1f2937',
    boxShadow: '0 4px 14px rgba(255, 255, 255, 0.05)',
    transition: 'all 0.2s',
    outline: 'none',
  },
  microsoftButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '12px 18px',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    background: '#2f2f2f',
    color: '#ffffff',
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
    transition: 'all 0.2s',
    outline: 'none',
  },
  templeButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '12px 18px',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid transparent',
    background: '#9e1b34', // Cherry red
    color: '#ffffff',
    boxShadow: '0 4px 14px rgba(158, 27, 52, 0.25)',
    transition: 'all 0.2s',
    outline: 'none',
  },
  templeIcon: {
    width: 20,
    height: 20,
    background: '#ffffff',
    color: '#9e1b34',
    borderRadius: '4px',
    fontWeight: 'bold',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: '#ef4444',
    fontSize: 13,
    margin: 0,
  }
};
