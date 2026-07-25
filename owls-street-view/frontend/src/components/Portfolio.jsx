import React, { useState } from 'react';
import { closePosition } from '../api';

const s = {
  card: { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' },
  title: { padding: '14px 18px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { padding: '8px 16px', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 500, fontSize: 12 },
  thLeft: { padding: '8px 16px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 500, fontSize: 12 },
  td: { padding: '10px 16px', textAlign: 'right', borderTop: '1px solid var(--border-subtle)', color: 'var(--text-primary)' },
  tdLeft: { padding: '10px 16px', textAlign: 'left', borderTop: '1px solid var(--border-subtle)', fontWeight: 600 },
  empty: { padding: 32, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 },
  tdAct: { padding: '10px 12px', borderTop: '1px solid var(--border-subtle)', verticalAlign: 'top' },
  btnRow: { display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' },
  exitBtn: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)',
    borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 11,
  },
  exitPrimary: {
    background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)',
    borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 11,
  },
  partialBox: { marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' },
  partialInput: {
    width: 64, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text-primary)', padding: '4px 6px', fontSize: 11,
  },
  err: { fontSize: 10, color: 'var(--danger)', maxWidth: 140, textAlign: 'right' },
};

function colorPL(val) {
  if (val === null || val === undefined) return 'var(--text-secondary)';
  return val >= 0 ? 'var(--success)' : 'var(--danger)';
}

export default function Portfolio({ positions, loading, onRefresh }) {
  const [partialFor, setPartialFor] = useState(null);
  const [partialQty, setPartialQty] = useState('');
  const [busy, setBusy] = useState(null);
  const [errBy, setErrBy] = useState({});

  async function submitCloseAll(p) {
    setErrBy((e) => ({ ...e, [p.symbol]: null }));
    if (!window.confirm(`Market-close entire ${p.symbol} position (${p.qty} ${p.side})?`)) return;
    setBusy(p.symbol);
    try {
      await closePosition(p.symbol);
      setPartialFor(null);
      onRefresh?.();
    } catch (e) {
      setErrBy((x) => ({ ...x, [p.symbol]: e.message }));
    } finally {
      setBusy(null);
    }
  }

  async function submitPartial(p) {
    const q = Number(partialQty);
    setErrBy((e) => ({ ...e, [p.symbol]: null }));
    if (!q || q <= 0 || q > p.qty) {
      setErrBy((x) => ({ ...x, [p.symbol]: `Qty must be 1–${p.qty}` }));
      return;
    }
    if (!window.confirm(`Market-close ${q} of ${p.symbol} (open: ${p.qty})?`)) return;
    setBusy(p.symbol);
    try {
      await closePosition(p.symbol, q);
      setPartialFor(null);
      setPartialQty('');
      onRefresh?.();
    } catch (e) {
      setErrBy((x) => ({ ...x, [p.symbol]: e.message }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={s.card}>
      <div style={s.title}>Positions ({positions.length})</div>
      {loading ? (
        <div style={s.empty}>Loading…</div>
      ) : positions.length === 0 ? (
        <div style={s.empty}>No open positions</div>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.thLeft}>Symbol</th>
              <th style={s.th}>Side</th>
              <th style={s.th}>Qty</th>
              <th style={s.th}>Avg Cost</th>
              <th style={s.th}>Current</th>
              <th style={s.th}>Market Val</th>
              <th style={s.th}>P&L</th>
              <th style={s.th}>P&L %</th>
              <th style={s.th}>Exit</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.symbol}>
                <td style={s.tdLeft}>{p.symbol}</td>
                <td style={{ ...s.td, textTransform: 'uppercase', fontSize: 11, color: 'var(--text-secondary)' }}>
                  {p.side || '—'}
                </td>
                <td style={s.td}>{p.qty}</td>
                <td style={s.td}>${Number(p.avg_entry_price).toFixed(2)}</td>
                <td style={s.td}>{p.current_price ? `$${Number(p.current_price).toFixed(2)}` : '—'}</td>
                <td style={s.td}>{p.market_value ? `$${Number(p.market_value).toFixed(2)}` : '—'}</td>
                <td style={{ ...s.td, color: colorPL(p.unrealized_pl) }}>
                  {p.unrealized_pl !== null ? `${p.unrealized_pl >= 0 ? '+' : ''}${Number(p.unrealized_pl).toFixed(2)}` : '—'}
                </td>
                <td style={{ ...s.td, color: colorPL(p.unrealized_plpc) }}>
                  {p.unrealized_plpc !== null ? `${(p.unrealized_plpc * 100).toFixed(2)}%` : '—'}
                </td>
                <td style={s.tdAct}>
                  <div style={s.btnRow}>
                    <button
                      type="button"
                      style={s.exitPrimary}
                      disabled={busy === p.symbol}
                      onClick={() => submitCloseAll(p)}
                    >
                      {busy === p.symbol ? '…' : 'Close all'}
                    </button>
                    <button
                      type="button"
                      style={s.exitBtn}
                      disabled={busy === p.symbol}
                      onClick={() => {
                        setPartialFor((v) => (v === p.symbol ? null : p.symbol));
                        setPartialQty('');
                        setErrBy((e) => ({ ...e, [p.symbol]: null }));
                      }}
                    >
                      {partialFor === p.symbol ? 'Hide partial' : 'Partial'}
                    </button>
                    {partialFor === p.symbol && (
                      <div style={s.partialBox}>
                        <input
                          style={s.partialInput}
                          type="number"
                          min="0.01"
                          step="0.01"
                          max={p.qty}
                          placeholder="Qty"
                          value={partialQty}
                          onChange={(e) => setPartialQty(e.target.value)}
                        />
                        <button
                          type="button"
                          style={s.exitBtn}
                          disabled={busy === p.symbol}
                          onClick={() => submitPartial(p)}
                        >
                          Submit
                        </button>
                      </div>
                    )}
                    {errBy[p.symbol] && <div style={s.err}>{errBy[p.symbol]}</div>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
