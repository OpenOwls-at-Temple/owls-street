import React, { useEffect, useState, useCallback, useRef } from 'react';
import Header from './components/Header';
import Portfolio from './components/Portfolio';
import ChartPanel from './components/Chart';
import Watchlist from './components/Watchlist';
import OrderPanel from './components/OrderPanel';
import Orders from './components/Orders';
import Screener from './components/Screener';
import Lockscreen from './components/Lockscreen';
import { DEFAULT_WATCHLIST_SYMBOLS } from './symbols';
import { getAccount, getClock, getPositions } from './api';

const SIDEBAR_W_KEY = 'alpaca-tradeview-sidebar-w';
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 720;
const SIDEBAR_DEFAULT = 288;
const WORKSPACE_KEY = 'alpaca-tradeview-workspace-v1';
const THEME_KEY = 'alpaca-tradeview-theme';
const RIGHT_RAIL_KEY = 'alpaca-tradeview-right-rail-expanded';
const RIGHT_RAIL_W_KEY = 'alpaca-tradeview-right-rail-w';
const RIGHT_RAIL_MIN = 200;
const RIGHT_RAIL_MAX = 720;
const RIGHT_RAIL_DEFAULT = 240;
const RIGHT_RAIL_COLLAPSED_W = 44;

function readSavedSidebarWidth() {
  try {
    const s = localStorage.getItem(SIDEBAR_W_KEY);
    if (s) {
      const w = parseInt(s, 10);
      if (!Number.isNaN(w) && w >= SIDEBAR_MIN && w <= SIDEBAR_MAX) return w;
    }
  } catch (_) {}
  return SIDEBAR_DEFAULT;
}

const layout = {
  app: { minHeight: '100vh', display: 'flex', background: 'var(--bg-app)', color: 'var(--text-primary)' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  content: { flex: 1, padding: 24, maxWidth: 1800, margin: '0 auto', width: '100%', overflowY: 'auto' },
  col: { display: 'flex', flexDirection: 'column', gap: 16 },
  banner: {
    background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)', borderRadius: 8, padding: '12px 18px',
    color: 'var(--danger)', fontSize: 13, marginBottom: 16,
  },
};

const sepStyle = {
  flexShrink: 0,
  width: 6,
  marginRight: 10,
  cursor: 'col-resize',
  alignSelf: 'stretch',
  minHeight: 120,
  borderRadius: 2,
  background: 'transparent',
  borderLeft: '1px solid var(--border)',
  borderRight: '1px solid var(--border)',
};

const rightSepStyle = {
  ...sepStyle,
  marginRight: 0,
  marginLeft: 10,
};

function readSavedTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch (_) {}
  return 'dark';
}

function readRightRailExpanded() {
  try {
    const s = localStorage.getItem(RIGHT_RAIL_KEY);
    if (s === 'false') return false;
    if (s === 'true') return true;
  } catch (_) {}
  return true;
}

function readSavedRightRailWidth() {
  try {
    const s = localStorage.getItem(RIGHT_RAIL_W_KEY);
    if (s) {
      const w = parseInt(s, 10);
      if (!Number.isNaN(w) && w >= RIGHT_RAIL_MIN && w <= RIGHT_RAIL_MAX) return w;
    }
  } catch (_) {}
  return RIGHT_RAIL_DEFAULT;
}

const orderRailToggleBtn = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  color: 'var(--text-secondary)',
  borderRadius: 6,
  padding: '4px 8px',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
};

export default function App() {
  // Authentication states
  const [authorized, setAuthorized] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [user, setUser] = useState(null);
  const [serverStatus, setServerStatus] = useState('disconnected'); // 'online' or 'disconnected'
  const [pulseUrl, setPulseUrl] = useState('http://localhost:8000');
  const [pulseOnline, setPulseOnline] = useState(false);
  const [pulseChecking, setPulseChecking] = useState(false);

  // Application states
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [posLoading, setPosLoading] = useState(true);
  const [selectedSymbol, setSelectedSymbol] = useState('AAPL');
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [apiError, setApiError] = useState(null);
  const [marketClock, setMarketClock] = useState(null);
  const [chartSplit, setChartSplit] = useState('single');
  const [secondarySymbol, setSecondarySymbol] = useState('MSFT');
  const [linkSymbols, setLinkSymbols] = useState(true);
  const [navExpanded, setNavExpanded] = useState(true);
  const [rightRailExpanded, setRightRailExpanded] = useState(readRightRailExpanded);
  const [rightRailWidth, setRightRailWidth] = useState(readSavedRightRailWidth);
  const [sidebarWidth, setSidebarWidth] = useState(readSavedSidebarWidth);
  const [theme, setTheme] = useState(readSavedTheme);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const rightRailWidthRef = useRef(rightRailWidth);
  rightRailWidthRef.current = rightRailWidth;

  const toggleNav = () => setNavExpanded((e) => !e);
  const toggleRightRail = () => setRightRailExpanded((e) => !e);
  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  // Authentication check logic
  const checkAuthStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setAuthEnabled(data.auth_enabled);
        setAuthorized(data.authorized);
        setServerStatus('online');
        setUser(data.user);
        if (data.pulse_url) {
          setPulseUrl(data.pulse_url);
        }
        setPulseOnline(!!data.pulse_online);
        if (data.authorized) {
          refresh();
        }
      } else {
        setServerStatus('disconnected');
      }
    } catch (e) {
      setServerStatus('disconnected');
    } finally {
      setAuthChecking(false);
    }
  }, []);

  const handleRetryPulse = async () => {
    setPulseChecking(true);
    await checkAuthStatus();
    await new Promise((resolve) => setTimeout(resolve, 800));
    setPulseChecking(false);
  };

  const handleUnlock = () => {
    setAuthorized(true);
    setServerStatus('online');
    checkAuthStatus();
    refresh();
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setAuthorized(false);
      setUser(null);
      checkAuthStatus();
    } catch (_) {}
  };

  useEffect(() => {
    checkAuthStatus();
    // Poll server status every 5 seconds (pulse animation check)
    const interval = setInterval(checkAuthStatus, 5000);
    return () => clearInterval(interval);
  }, [checkAuthStatus]);

  const startResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidthRef.current;
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + dx));
      setSidebarWidth(w);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      try {
        localStorage.setItem(SIDEBAR_W_KEY, String(sidebarWidthRef.current));
      } catch (_) {}
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const resetSidebarWidth = useCallback(() => {
    setSidebarWidth(SIDEBAR_DEFAULT);
    try {
      localStorage.setItem(SIDEBAR_W_KEY, String(SIDEBAR_DEFAULT));
    } catch (_) {}
  }, []);

  const startRightRailResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightRailWidthRef.current;
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const w = Math.min(RIGHT_RAIL_MAX, Math.max(RIGHT_RAIL_MIN, startW - dx));
      setRightRailWidth(w);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      try {
        localStorage.setItem(RIGHT_RAIL_W_KEY, String(rightRailWidthRef.current));
      } catch (_) {}
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const resetRightRailWidth = useCallback(() => {
    setRightRailWidth(RIGHT_RAIL_DEFAULT);
    try {
      localStorage.setItem(RIGHT_RAIL_W_KEY, String(RIGHT_RAIL_DEFAULT));
    } catch (_) {}
  }, []);

  const sidebarColStyle = {
    width: navExpanded ? sidebarWidth : 56,
    minWidth: navExpanded ? sidebarWidth : 56,
    maxWidth: navExpanded ? sidebarWidth : 56,
    flexShrink: 0,
  };

  const rightRailColStyle = {
    width: rightRailExpanded ? rightRailWidth : RIGHT_RAIL_COLLAPSED_W,
    minWidth: rightRailExpanded ? rightRailWidth : RIGHT_RAIL_COLLAPSED_W,
    maxWidth: rightRailExpanded ? rightRailWidth : RIGHT_RAIL_COLLAPSED_W,
    flexShrink: 0,
  };

  const resizeHandle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      title="Drag to resize · double-click to reset width"
      style={sepStyle}
      onMouseDown={startResize}
      onDoubleClick={resetSidebarWidth}
    />
  );

  const rightResizeHandle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize order column"
      title="Drag to resize · double-click to reset width"
      style={rightSepStyle}
      onMouseDown={startRightRailResize}
      onDoubleClick={resetRightRailWidth}
    />
  );

  const refresh = useCallback(async () => {
    try {
      const [acc, pos, clk] = await Promise.all([
        getAccount(),
        getPositions(),
        getClock().catch(() => null),
      ]);
      setAccount(acc);
      setPositions(pos);
      if (clk) setMarketClock(clk);
      setApiError(null);
    } catch (e) {
      if (e.message.includes('401') || e.message.toLowerCase().includes('unauthorized')) {
        setAuthorized(false);
      } else {
        setApiError(e.message);
      }
    } finally {
      setPosLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WORKSPACE_KEY);
      if (raw) {
        const ws = JSON.parse(raw);
        if (ws?.selectedSymbol) setSelectedSymbol(ws.selectedSymbol);
        if (ws?.activeTab) setActiveTab(ws.activeTab);
        if (ws?.chartSplit) setChartSplit(ws.chartSplit);
        if (ws?.secondarySymbol) setSecondarySymbol(ws.secondarySymbol);
        if (typeof ws?.linkSymbols === 'boolean') setLinkSymbols(ws.linkSymbols);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_) {}
    
    // Sync theme to the Pulse Alerts iframe if it is mounted
    try {
      const iframe = document.querySelector('iframe');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'SET_THEME', theme }, '*');
      }
    } catch (_) {}
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(RIGHT_RAIL_KEY, String(rightRailExpanded));
    } catch (_) {}
  }, [rightRailExpanded]);

  useEffect(() => {
    if (authorized) {
      refresh();
      const interval = setInterval(refresh, 30_000);
      return () => clearInterval(interval);
    }
  }, [refresh, authorized]);

  const saveWorkspace = useCallback(() => {
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
        selectedSymbol,
        activeTab,
        chartSplit,
        secondarySymbol,
        linkSymbols,
      }));
    } catch (_) {}
  }, [selectedSymbol, activeTab, chartSplit, secondarySymbol, linkSymbols]);

  const resetWorkspace = useCallback(() => {
    setChartSplit('single');
    setSecondarySymbol('MSFT');
    setLinkSymbols(true);
    try {
      localStorage.removeItem(WORKSPACE_KEY);
    } catch (_) {}
  }, []);

  const workspaceBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Workspace</span>
      <button type="button" onClick={saveWorkspace} style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, boxShadow: 'var(--shadow-soft)' }}>Save</button>
      <button type="button" onClick={resetWorkspace} style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>Reset</button>
      <select value={chartSplit} onChange={(e) => setChartSplit(e.target.value)} style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}>
        <option value="single">Single chart</option>
        <option value="double">Two charts</option>
      </select>
      {chartSplit === 'double' && (
        <>
          <input value={secondarySymbol} onChange={(e) => setSecondarySymbol(e.target.value.toUpperCase())} placeholder="2nd symbol" style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 12 }} />
          <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={linkSymbols} onChange={(e) => setLinkSymbols(e.target.checked)} />
            Link symbols
          </label>
        </>
      )}
    </div>
  );

  // Authentication gating
  if (authChecking) {
    return (
      <div style={{ display: 'flex', width: '100vw', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0b0f19', color: '#fff' }}>
        <div style={{ fontSize: 16, fontWeight: 500 }}>Initializing system...</div>
      </div>
    );
  }

  if (authEnabled && !authorized) {
    return <Lockscreen onUnlock={handleUnlock} theme={theme} onToggleTheme={toggleTheme} />;
  }

  return (
    <div style={layout.app}>
      {/* 1. Pulse-styled left Sidebar */}
      <div style={sidebarStyles.sidebar}>
        <div style={sidebarStyles.logoContainer}>
          <div style={sidebarStyles.logoIcon}>
            <svg fill="none" stroke="#fff" strokeWidth="2.5" viewBox="0 0 24 24" style={{ width: 18, height: 18 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
          </div>
          <span style={sidebarStyles.logoText}>Owl Street View</span>
        </div>

        <ul style={sidebarStyles.navLinks}>
          {[
            { id: 'Dashboard', icon: <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg> },
            { id: 'Chart', icon: <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" /></svg> },
            { id: 'Screener', icon: <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" /></svg> },
            { id: 'Orders', icon: <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.03 0 1.9.693 2.166 1.638m-7.377 0A48.536 48.536 0 0112 3c2.755 0 5.455.232 8.083.678" /></svg> },
            { id: 'Pulse Alerts', icon: <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0M3.124 7.5A8.969 8.969 0 015.292 3m13.416 0a8.969 8.969 0 012.168 4.5" /></svg> }
          ].map((item) => {
            const isActive = activeTab === item.id;
            return (
              <li key={item.id}>
                <div
                  style={{
                    ...sidebarStyles.navItem,
                    ...(isActive ? sidebarStyles.navItemActive : {})
                  }}
                  onClick={() => setActiveTab(item.id)}
                >
                  <span style={sidebarStyles.navIcon(isActive)}>{item.icon}</span>
                  {item.id}
                </div>
              </li>
            );
          })}
        </ul>

        {authorized && user && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 0',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            marginTop: 'auto',
            marginBottom: 10,
            overflow: 'hidden',
          }}>
            <img 
              src={user.avatar || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp'} 
              style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.1)' }}
              alt="avatar"
            />
            <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', maxWidth: 120 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name || 'User'}</span>
              <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email || ''}</span>
            </div>
            {user.provider && (
              <span style={{
                marginLeft: 'auto',
                fontSize: 8,
                fontWeight: 700,
                padding: '2px 4px',
                borderRadius: 4,
                textTransform: 'uppercase',
                background: user.provider === 'google' ? 'rgba(66, 133, 244, 0.15)' : 'rgba(255,255,255,0.05)',
                color: user.provider === 'google' ? '#4285f4' : '#9ca3af',
              }}>
                {user.provider}
              </span>
            )}
          </div>
        )}

        <div style={{ ...sidebarStyles.sidebarFooter, marginTop: (authorized && user) ? 0 : 'auto', borderTop: (authorized && user) ? 'none' : sidebarStyles.sidebarFooter.borderTop }}>
          <div style={sidebarStyles.statusBadge}>
            <span style={sidebarStyles.pulseDot(serverStatus === 'online')}></span>
            {serverStatus.toUpperCase()}
          </div>
          {authEnabled && (
            <button style={sidebarStyles.logoutBtn} onClick={handleLogout}>
              Logout
            </button>
          )}
        </div>
      </div>

      {/* 2. Main content container */}
      <div style={layout.main}>
        <Header
          account={account}
          marketClock={marketClock}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <div style={layout.content}>
          {apiError && (
            <div style={layout.banner}>
              Backend error: {apiError} — make sure the FastAPI server is running on port 8080
            </div>
          )}

          {activeTab === 'Dashboard' && (
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', width: '100%' }}>
              <div style={{ display: 'flex', flexShrink: 0, alignItems: 'stretch', gap: 0 }}>
                <div style={{ ...sidebarColStyle, ...layout.col }}>
                  <Watchlist
                    selectedSymbol={selectedSymbol}
                    onSelectSymbol={setSelectedSymbol}
                    collapsed={!navExpanded}
                    onToggleNav={toggleNav}
                  />
                </div>
                {navExpanded ? resizeHandle : <div style={{ width: 16, flexShrink: 0 }} aria-hidden />}
              </div>
              <div style={{ ...layout.col, flex: 1, minWidth: 0 }}>
                {workspaceBar}
                {chartSplit === 'single' ? (
                  <ChartPanel key={selectedSymbol} symbol={selectedSymbol} theme={theme} />
                ) : (
                  <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr', marginBottom: 16 }}>
                    <ChartPanel key={`dash-p1-${selectedSymbol}`} symbol={selectedSymbol} theme={theme} />
                    <ChartPanel key={`dash-p2-${linkSymbols ? selectedSymbol : secondarySymbol}`} symbol={linkSymbols ? selectedSymbol : secondarySymbol} theme={theme} />
                  </div>
                )}
                <Portfolio positions={positions} loading={posLoading} onRefresh={refresh} />
              </div>
              <div style={{ display: 'flex', flexShrink: 0, alignItems: 'stretch', gap: 0 }}>
                {rightRailExpanded ? rightResizeHandle : <div style={{ width: 16, flexShrink: 0 }} aria-hidden />}
                <div style={{ ...layout.col, ...rightRailColStyle }}>
                  {rightRailExpanded ? (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingBottom: 10,
                          marginBottom: 4,
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Orders</span>
                        <button
                          type="button"
                          style={orderRailToggleBtn}
                          onClick={toggleRightRail}
                          title="Collapse order column"
                          aria-expanded={true}
                        >
                          «
                        </button>
                      </div>
                      <OrderPanel symbol={selectedSymbol} buyingPower={account?.buying_power} marketClock={marketClock} />
                      {account && <AccountCard account={account} />}
                    </>
                  ) : (
                    <div
                      style={{
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        alignSelf: 'stretch',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        padding: '10px 6px',
                        gap: 8,
                      }}
                    >
                      <button
                        type="button"
                        style={orderRailToggleBtn}
                        onClick={toggleRightRail}
                        title="Expand orders & account"
                        aria-expanded={false}
                      >
                        ››
                      </button>
                      <span
                        style={{
                          writingMode: 'vertical-rl',
                          transform: 'rotate(180deg)',
                          fontSize: 11,
                          fontWeight: 600,
                          color: 'var(--text-muted)',
                          letterSpacing: 1,
                          userSelect: 'none',
                        }}
                      >
                        Order
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Chart' && (
            <>
              {workspaceBar}
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', width: '100%' }}>
                <div style={{ display: 'flex', flexShrink: 0, alignItems: 'stretch', gap: 0 }}>
                  <div style={{ ...sidebarColStyle, ...layout.col }}>
                    <Watchlist
                      selectedSymbol={selectedSymbol}
                      onSelectSymbol={setSelectedSymbol}
                      collapsed={!navExpanded}
                      onToggleNav={toggleNav}
                    />
                  </div>
                  {navExpanded ? resizeHandle : <div style={{ width: 16, flexShrink: 0 }} aria-hidden />}
                </div>
                <div style={{ ...layout.col, flex: 1, minWidth: 0 }}>
                  {chartSplit === 'single' ? (
                    <ChartPanel key={selectedSymbol} symbol={selectedSymbol} theme={theme} />
                  ) : (
                    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
                      <ChartPanel key={`p1-${selectedSymbol}`} symbol={selectedSymbol} theme={theme} />
                      <ChartPanel key={`p2-${linkSymbols ? selectedSymbol : secondarySymbol}`} symbol={linkSymbols ? selectedSymbol : secondarySymbol} theme={theme} />
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {activeTab === 'Screener' && (
            <Screener
              watchlistSymbols={DEFAULT_WATCHLIST_SYMBOLS}
              onPickSymbol={setSelectedSymbol}
              onGoToChart={() => setActiveTab('Chart')}
              onClose={() => setActiveTab('Dashboard')}
            />
          )}

          {activeTab === 'Orders' && <Orders />}

          {activeTab === 'Pulse Alerts' && (
            <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: 'calc(100vh - 120px)', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', backdropFilter: 'blur(12px)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'rgba(0, 0, 0, 0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: pulseOnline ? 'var(--success)' : 'var(--warning)', boxShadow: pulseOnline ? '0 0 8px var(--success)' : '0 0 8px var(--warning)' }}></span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                    Owl Street Pulse Integration {pulseOnline ? '(Online)' : '(Offline)'}
                  </span>
                </div>
                {pulseOnline && (
                  <a href={pulseUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500 }}>
                    Open in New Tab
                    <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{ width: 12, height: 12 }}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
                  </a>
                )}
              </div>
              
              {pulseOnline ? (
                <iframe
                  src={`${pulseUrl}${pulseUrl.includes('?') ? '&' : '?'}theme=${theme}`}
                  title="Owl Street Pulse Alerts System"
                  style={{ flex: 1, border: 'none', width: '100%', height: '100%', background: 'transparent' }}
                  sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
                />
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--text-primary)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
                    <span className="owl-anim-sleep">🦉💤</span>
                    <div className="zzz-container">
                      <span className="zzz-char">z</span>
                      <span className="zzz-char">z</span>
                      <span className="zzz-char">Z</span>
                    </div>
                  </div>
                  <h3 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 12px 0', background: 'linear-gradient(135deg, #fff, #9ca3af)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    The owls got tired delivering the alerts...
                  </h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: 15, maxWidth: 460, margin: '0 0 28px 0', lineHeight: 1.6 }}>
                    They've taken a quick power nap! Once you boot up the Owl Street Pulse service (run <code>./run.sh</code> inside <code>owl-street-pulse</code> folder), they will be right back at work.
                  </p>
                  <button
                    type="button"
                    onClick={handleRetryPulse}
                    disabled={pulseChecking}
                    style={{
                      background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))',
                      color: 'var(--accent-contrast)',
                      border: 'none',
                      borderRadius: 10,
                      padding: '12px 24px',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
                      transition: 'all 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      opacity: pulseChecking ? 0.7 : 1,
                    }}
                  >
                    {pulseChecking ? 'Pinging the forest... 🌲' : 'Wake Up the Owls with Coffee ☕'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AccountCard({ account }) {
  const rows = [
    ['Cash', `$${Number(account.cash).toLocaleString('en-US', { minimumFractionDigits: 2 })}`],
    ['Buying Power', `$${Number(account.buying_power).toLocaleString('en-US', { minimumFractionDigits: 2 })}`],
    ['Equity', `$${Number(account.equity).toLocaleString('en-US', { minimumFractionDigits: 2 })}`],
    ['Day Trades', account.day_trade_count],
  ];
  return (
    <div style={{ background: 'linear-gradient(180deg, var(--surface-grad-top), var(--surface-grad-bot)), var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, boxShadow: 'var(--shadow-card)' }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 12 }}>Account</div>
      {rows.map(([label, val]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
          <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
          <span>{val}</span>
        </div>
      ))}
    </div>
  );
}

// ── Sidebar Styles (Pulse design) ─────────────────────────────────────────────

const sidebarStyles = {
  sidebar: {
    width: 260,
    background: 'rgba(13, 18, 30, 0.95)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    padding: 24,
    flexShrink: 0,
    height: '100vh',
    position: 'sticky',
    top: 0,
  },
  logoContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 40,
  },
  logoIcon: {
    width: 36,
    height: 36,
    background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))',
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
  navLinks: {
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    flexGrow: 1,
    padding: 0,
    margin: 0,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 16px',
    borderRadius: 12,
    color: 'var(--text-secondary)',
    fontWeight: 500,
    cursor: 'pointer',
    fontSize: 15,
    transition: 'all 0.2s',
  },
  navItemActive: {
    color: '#fff',
    border: '1px solid var(--border)',
    background: 'linear-gradient(90deg, rgba(99, 102, 241, 0.08) 0%, rgba(139, 92, 246, 0.02) 100%)',
    boxShadow: 'inset 0 0 12px rgba(255, 255, 255, 0.02)',
  },
  navIcon: (active) => ({
    width: 20,
    height: 20,
    display: 'flex',
    alignItems: 'center',
    color: active ? 'var(--accent)' : 'inherit',
    transition: 'color 0.2s',
  }),
  sidebarFooter: {
    marginTop: 'auto',
    borderTop: '1px solid var(--border)',
    paddingTop: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
  pulseDot: (running) => ({
    width: 10,
    height: 10,
    borderRadius: '50%',
    display: 'inline-block',
    background: running ? 'var(--success)' : 'var(--danger)',
    boxShadow: running ? '0 0 0 0 rgba(16, 185, 129, 0.7)' : '0 0 0 0 rgba(239, 68, 68, 0.7)',
    animation: running ? 'pulse-green 1.5s infinite' : 'pulse-red 1.5s infinite',
  }),
  logoutBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--danger)',
    fontSize: 13,
    cursor: 'pointer',
    fontWeight: 500,
    padding: 0,
  }
};
