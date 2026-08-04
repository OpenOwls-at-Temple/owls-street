import React from 'react';

const s = {
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 32px',
    background: 'var(--bg-muted)',
    borderBottom: '1px solid var(--border)',
    backdropFilter: 'blur(var(--glass-blur)) saturate(150%)',
    WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(150%)',
  },
  logoContainer: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  badge: {
    fontSize: 11, padding: '2px 8px', borderRadius: 6,
    background: 'var(--bg-elevated)', color: 'var(--accent-text)', border: '1px solid var(--accent-soft)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  account: { display: 'flex', alignItems: 'center', gap: 24 },
  accountDetails: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 },
  equity: { fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' },
  pl: (val) => ({ fontSize: 12, fontWeight: 600, color: val >= 0 ? 'var(--success)' : 'var(--danger)' }),
  marketClosed: {
    fontSize: 11,
    padding: '4px 10px',
    borderRadius: 8,
    background: 'var(--warning-soft)',
    color: 'var(--warning)',
    border: '1px solid var(--warning-border)',
    lineHeight: 1.35,
  },
  themeBtn: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '6px 12px',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
    boxShadow: 'var(--shadow-soft)',
    transition: 'all 0.2s',
  },
};

function formatNextOpenEt(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return null;
  }
}

export default function Header({ account, marketClock, theme, onToggleTheme }) {
  const pl = account ? account.equity - account.last_equity : 0;
  const plPct = account && account.last_equity ? (pl / account.last_equity) * 100 : 0;

  return (
    <header style={s.header}>
      <div style={s.logoContainer}>
        <span style={s.badge}>Paper Trading</span>
        {marketClock != null && !marketClock.is_open && (
          <span
            style={s.marketClosed}
            role="status"
            title={
              marketClock.next_open
                ? `Next session open (US/Eastern): ${formatNextOpenEt(marketClock.next_open) ?? marketClock.next_open}`
                : 'US stock market session is closed (Alpaca clock).'
            }
          >
            <strong>Market is closed</strong>
            {marketClock.next_open && (
              <span> (Next open: {formatNextOpenEt(marketClock.next_open) ?? '—'})</span>
            )}
          </span>
        )}
      </div>
      <div style={s.account}>
        <button type="button" style={s.themeBtn} onClick={onToggleTheme}>
          {theme === 'dark' ? 'Light' : 'Dark'} Mode
        </button>
        {account && (
          <div style={s.accountDetails}>
            <span style={s.equity}>${Number(account.portfolio_value).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            <span style={s.pl(pl)}>
              {pl >= 0 ? '+' : ''}{pl.toFixed(2)} ({plPct >= 0 ? '+' : ''}{plPct.toFixed(2)}%) today
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
