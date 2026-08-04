import React, { useEffect, useState, useRef } from 'react';
import { getSnapshot, createQuoteSocket, getOptionChainMatrix, getOptionExpirations } from '../api';
import { DEFAULT_WATCHLIST_SYMBOLS } from '../symbols';
import OptionChainMatrix from './OptionChainMatrix';

const DEFAULT_SYMBOLS = [...DEFAULT_WATCHLIST_SYMBOLS];

const toggleBtn = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  color: 'var(--text-secondary)',
  borderRadius: 8,
  padding: '6px 10px',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1,
  transition: 'all 0.2s',
};

const s = {
  card: {
    background: 'var(--bg-surface)',
    backdropFilter: 'blur(var(--glass-blur)) saturate(150%)',
    WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(150%)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    overflow: 'hidden',
    boxShadow: 'var(--shadow-card)',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid var(--border)',
  },
  title: { fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.2px' },
  addRow: { display: 'flex', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'rgba(0, 0, 0, 0.15)' },
  input: {
    flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 10,
    color: 'var(--text-primary)', padding: '8px 12px', fontSize: 13, outline: 'none',
    transition: 'border-color 0.2s',
  },
  addBtn: {
    background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))',
    color: '#fff', border: 'none', borderRadius: 10,
    padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    boxShadow: 'var(--shadow-soft)',
    transition: 'all 0.2s',
  },
  secondaryBtn: {
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 10,
    padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 500,
    transition: 'all 0.2s',
  },
  row: (selected) => ({
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 20px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)',
    background: selected ? 'linear-gradient(90deg, rgba(99, 102, 241, 0.08) 0%, rgba(139, 92, 246, 0.02) 100%)' : 'transparent',
    borderLeft: selected ? '3px solid var(--accent)' : '3px solid transparent',
    transition: 'all 0.2s',
  }),
  symbol: { fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' },
  chainBox: {
    borderBottom: '1px solid var(--border)', padding: '16px 20px', fontSize: 12, color: 'var(--text-secondary)',
    background: 'rgba(0, 0, 0, 0.05)',
  },
  chainRow: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 },
  chainSelect: {
    background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-primary)',
    padding: '8px 12px', fontSize: 12, outline: 'none', cursor: 'pointer',
  },
  chainList: { maxHeight: 180, overflowY: 'auto', borderTop: '1px solid var(--border-subtle)' },
  chainItem: {
    display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 12px', fontSize: 12,
    cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)',
    transition: 'background 0.2s',
  },
  chainItemSym: { color: 'var(--accent)', fontWeight: 600, wordBreak: 'break-all', flex: 1 },
  hint: { fontSize: 11, color: 'var(--text-muted)', padding: '10px 20px 0', lineHeight: 1.4 },
  rowRight: { display: 'flex', alignItems: 'center', gap: 4 },
  removeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 17,
    lineHeight: 1,
    padding: '3px 6px',
    marginLeft: 6,
    transition: 'color 0.2s, background 0.2s',
  },
  empty: {
    padding: '20px', fontSize: 12, color: 'var(--text-muted)',
    textAlign: 'center', lineHeight: 1.5,
  },
  right: { textAlign: 'right' },
  price: { fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' },
  change: (pct) => ({ fontSize: 12, fontWeight: 500, color: pct >= 0 ? 'var(--success)' : 'var(--danger)' }),
};

function shortSym(label) {
  const s = String(label);
  return s.length <= 5 ? s : `${s.slice(0, 4)}…`;
}

function formatExpiryLabel(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
  const rest = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${rest} (${weekday})`;
}

export default function Watchlist({ selectedSymbol, onSelectSymbol, collapsed, onToggleNav }) {
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);
  const [snapshots, setSnapshots] = useState({});
  const [liveQuotes, setLiveQuotes] = useState({});
  const [inputVal, setInputVal] = useState('');
  const wsRef = useRef(null);

  const [chainUnderlying, setChainUnderlying] = useState('SPX');
  const [chainExpiry, setChainExpiry] = useState('');
  const [chainExpirations, setChainExpirations] = useState([]);
  const [expLoading, setExpLoading] = useState(false);
  const [expErr, setExpErr] = useState(null);
  const [chainMatrix, setChainMatrix] = useState(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainErr, setChainErr] = useState(null);

  useEffect(() => {
    setChainMatrix(null);
  }, [chainUnderlying, chainExpiry]);

  useEffect(() => {
    const u = chainUnderlying.trim().toUpperCase();
    if (!u) {
      setChainExpirations([]);
      return;
    }
    setExpErr(null);
    const t = setTimeout(() => {
      setExpLoading(true);
      setChainExpirations([]);
      setChainExpiry('');
      getOptionExpirations(u)
        .then((r) => {
          const ex = Array.isArray(r.expirations) ? r.expirations : [];
          setChainExpirations(ex);
          setChainExpiry((prev) => (prev && ex.includes(prev) ? prev : ex[0] || ''));
        })
        .catch((e) => {
          setChainExpirations([]);
          setExpErr(e.message || 'Could not load expirations');
        })
        .finally(() => setExpLoading(false));
    }, 350);
    return () => clearTimeout(t);
  }, [chainUnderlying]);

  useEffect(() => {
    symbols.forEach(async (sym) => {
      try {
        const snap = await getSnapshot(sym);
        setSnapshots((prev) => ({ ...prev, [sym]: snap }));
      } catch (_) {}
    });
  }, [symbols]);

  useEffect(() => {
    if (wsRef.current) wsRef.current.close();
    wsRef.current = createQuoteSocket(symbols, (quote) => {
      setLiveQuotes((prev) => ({ ...prev, [quote.symbol]: quote }));
    });
    return () => wsRef.current?.close();
  }, [symbols]);

  function addSymbol(symRaw) {
    const sym = (symRaw ?? inputVal).trim().toUpperCase();
    if (sym && !symbols.includes(sym)) setSymbols((p) => [...p, sym]);
    if (!symRaw) setInputVal('');
  }

  function removeSymbol(sym) {
    const index = symbols.indexOf(sym);
    if (index === -1) return;

    const next = symbols.filter((s) => s !== sym);
    setSymbols(next);

    // Removing the symbol currently being charted would otherwise leave the chart, order
    // panel and Owl Speaks pointed at something no longer in the list. Fall through to its
    // neighbour instead, and leave the selection alone when nothing is left to move to.
    if (sym === selectedSymbol && next.length) {
      onSelectSymbol(next[Math.min(index, next.length - 1)]);
    }
  }

  async function loadOptionMatrix() {
    setChainErr(null);
    setChainLoading(true);
    try {
      const u = chainUnderlying.trim().toUpperCase() || 'SPY';
      const exp = chainExpiry.trim();
      if (!exp) {
        setChainErr('Select an expiration');
        setChainMatrix(null);
        return;
      }
      const data = await getOptionChainMatrix(u, exp, { wing: 36 });
      setChainMatrix(data && data.strikes?.length ? data : null);
      if (data && !data.strikes?.length) setChainErr('No contracts for this expiry');
    } catch (e) {
      setChainErr(e.message || 'Chain request failed');
      setChainMatrix(null);
    } finally {
      setChainLoading(false);
    }
  }

  function pickOptionContract(sym) {
    addSymbol(sym);
    onSelectSymbol(sym);
  }

  if (collapsed) {
    return (
      <div style={{ ...s.card, alignSelf: 'stretch' }}>
        <div style={{ ...s.head, justifyContent: 'center', padding: '12px 6px' }}>
          <button type="button" style={toggleBtn} onClick={onToggleNav} title="Expand watchlist">
            ››
          </button>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            alignItems: 'center',
            padding: '12px 6px 18px',
            maxHeight: 'calc(100vh - 140px)',
            overflowY: 'auto',
          }}
        >
          {symbols.map((sym) => (
            <button
              key={sym}
              type="button"
              title={sym}
              onClick={() => onSelectSymbol(sym)}
              style={{
                width: 42,
                minHeight: 38,
                borderRadius: 8,
                border: `1px solid ${selectedSymbol === sym ? 'var(--accent)' : 'var(--border)'}`,
                background: selectedSymbol === sym ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.05))' : 'var(--bg-input)',
                color: selectedSymbol === sym ? 'var(--accent-text)' : 'var(--text-secondary)',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
                padding: 4,
                lineHeight: 1.15,
                wordBreak: 'break-word',
                transition: 'all 0.2s',
              }}
            >
              {shortSym(sym)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={s.card}>
      <div style={s.head}>
        <span style={s.title}>Watchlist</span>
        <button type="button" style={toggleBtn} onClick={onToggleNav} title="Collapse sidebar">
          «
        </button>
      </div>
      <div style={s.addRow}>
        <input
          style={s.input} placeholder="Ticker or OCC option…" value={inputVal}
          onChange={(e) => setInputVal(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && addSymbol()}
          onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
          onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
        />
        <button style={s.addBtn} onClick={() => addSymbol()}>Add</button>
      </div>
      <div style={s.hint}>Stocks/ETFs or full OCC contracts (index/equity options).</div>

      <div style={s.chainBox}>
        <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)', fontSize: 13 }}>Options Chain</div>
        <div style={s.chainRow}>
          <input
            style={{ ...s.input, width: 68, marginBottom: 0, padding: '6px 8px' }}
            title="Underlying (e.g. SPX, NDX, SPXW, SPY, AAPL)"
            placeholder="SPX"
            value={chainUnderlying}
            onChange={(e) => setChainUnderlying(e.target.value.toUpperCase())}
            onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
          />
          <select
            style={{ ...s.chainSelect, minWidth: 150, flex: 1 }}
            value={chainExpiry}
            onChange={(e) => setChainExpiry(e.target.value)}
            disabled={expLoading || chainExpirations.length === 0}
            title="Expiration date"
          >
            {!chainExpirations.length && !expLoading && <option value="">No dates</option>}
            {expLoading && <option value="">Loading…</option>}
            {chainExpirations.map((d) => (
              <option key={d} value={d}>
                {formatExpiryLabel(d)}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button
            type="button"
            style={{ ...s.secondaryBtn, flex: 1, opacity: expLoading ? 0.6 : 1 }}
            onClick={() => {
              const u = chainUnderlying.trim().toUpperCase();
              if (!u) return;
              setExpLoading(true);
              setExpErr(null);
              getOptionExpirations(u)
                .then((r) => {
                  const ex = Array.isArray(r.expirations) ? r.expirations : [];
                  setChainExpirations(ex);
                  setChainExpiry((prev) => (prev && ex.includes(prev) ? prev : ex[0] || ''));
                })
                .catch((e) => setExpErr(e.message || 'Could not load expirations'))
                .finally(() => setExpLoading(false));
            }}
            disabled={expLoading}
          >
            Refresh Dates
          </button>
          <button type="button" style={{ ...s.addBtn, flex: 1.2 }} onClick={loadOptionMatrix} disabled={chainLoading || !chainExpiry}>
            {chainLoading ? 'Loading…' : 'Load Chain Matrix'}
          </button>
        </div>
        
        {expErr && <div style={{ color: 'var(--danger)', marginTop: 8, fontSize: 11, fontWeight: 500 }}>{expErr}</div>}
        {chainErr && <div style={{ color: 'var(--danger)', marginTop: 8, fontSize: 11, fontWeight: 500 }}>{chainErr}</div>}
        {chainMatrix && (
          <OptionChainMatrix
            data={chainMatrix}
            selectedSymbol={selectedSymbol}
            onPickContract={pickOptionContract}
          />
        )}
      </div>

      <div style={{ maxHeight: 350, overflowY: 'auto' }}>
        {!symbols.length && (
          <div style={s.empty}>
            Watchlist is empty.<br />Add a ticker or option contract above.
          </div>
        )}
        {symbols.map((sym) => {
          const snap = snapshots[sym];
          const live = liveQuotes[sym];
          const price = live
            ? (live.ask_price + live.bid_price) / 2
            : snap?.daily_bar?.close;
          const prevClose = snap?.prev_daily_bar?.close;
          const changePct = price && prevClose ? ((price - prevClose) / prevClose) * 100 : null;

          return (
            <div key={sym} style={s.row(selectedSymbol === sym)} onClick={() => onSelectSymbol(sym)}>
              <span style={s.symbol}>{sym}</span>
              <div style={s.rowRight}>
                <div style={s.right}>
                  <div style={s.price}>{price ? `$${Number(price).toFixed(2)}` : '—'}</div>
                  {changePct !== null && (
                    <div style={s.change(changePct)}>
                      {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  style={s.removeBtn}
                  title={`Remove ${sym} from watchlist`}
                  aria-label={`Remove ${sym} from watchlist`}
                  // The row itself selects the symbol, so removal must not bubble into it.
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSymbol(sym);
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--danger)';
                    e.currentTarget.style.background = 'var(--bg-elevated)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--text-muted)';
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
