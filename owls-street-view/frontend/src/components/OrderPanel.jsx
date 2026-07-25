import React, { useMemo, useState } from 'react';
import { submitOrder } from '../api';
import { isOptionSymbol } from '../symbols';

const s = {
  card: { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
    padding: 0,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
  },
  headerTitle: { fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' },
  headerChevron: { fontSize: 12, color: 'var(--text-muted)', userSelect: 'none' },
  tabs: { display: 'flex', gap: 4, marginBottom: 12 },
  tab: (active) => ({
    flex: 1, padding: '6px 0', textAlign: 'center', borderRadius: 6, border: 'none',
    cursor: 'pointer', fontSize: 12,
    background: active ? 'var(--bg-elevated)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
  }),
  sideTabs: { display: 'flex', gap: 4, marginBottom: 10 },
  sideTab: (active, side) => ({
    flex: 1, padding: '8px 0', textAlign: 'center', borderRadius: 6, border: 'none',
    cursor: 'pointer', fontSize: 13, fontWeight: 600,
    background: active ? (side === 'buy' ? 'var(--bg-success-soft)' : 'var(--bg-danger-soft)') : 'var(--bg-input)',
    color: active ? (side === 'buy' ? 'var(--success)' : 'var(--danger)') : 'var(--text-secondary)',
  }),
  label: { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 },
  input: {
    width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text-primary)', padding: '8px 12px', fontSize: 13,
    outline: 'none', marginBottom: 10,
  },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  submitBtn: (side) => ({
    width: '100%', padding: '10px 0', borderRadius: 6, border: 'none',
    cursor: 'pointer', fontSize: 14, fontWeight: 600,
    background: side === 'buy' ? 'var(--success)' : 'var(--danger)', color: 'var(--accent-contrast)',
  }),
  error: { fontSize: 12, color: 'var(--danger)', marginTop: 8, lineHeight: 1.35 },
  success: { fontSize: 12, color: 'var(--success)', marginTop: 8 },
  info: { fontSize: 12, color: 'var(--warning)', marginBottom: 10, lineHeight: 1.35 },
};

const ORDER_TYPES = ['market', 'limit', 'stop', 'stop_limit', 'trailing_stop'];
const ORDER_CLASSES = ['simple', 'bracket', 'oco', 'oto'];

function toNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function OrderPanel({ symbol, buyingPower, marketClock }) {
  const opt = symbol && isOptionSymbol(symbol);
  const marketClosed = marketClock != null && !marketClock.is_open;

  const [orderType, setOrderType] = useState('market');
  const [orderClass, setOrderClass] = useState('simple');
  const [side, setSide] = useState('buy');
  const [qty, setQty] = useState('');
  const [notional, setNotional] = useState('');
  const [useNotional, setUseNotional] = useState(false);
  const [tif, setTif] = useState('day');
  const [extended, setExtended] = useState(false);
  const [clientOrderId, setClientOrderId] = useState('');

  const [limitPrice, setLimitPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [trailPrice, setTrailPrice] = useState('');
  const [trailPercent, setTrailPercent] = useState('');
  const [tp, setTp] = useState('');
  const [slStop, setSlStop] = useState('');
  const [slLimit, setSlLimit] = useState('');

  const [status, setStatus] = useState(null);
  const [expanded, setExpanded] = useState(true);

  const allowsExtended = !opt;
  const showLimit = orderType === 'limit' || orderType === 'stop_limit';
  const showStop = orderType === 'stop' || orderType === 'stop_limit';
  const showTrailing = orderType === 'trailing_stop';
  const usingBracket = orderClass !== 'simple';

  const precheckMsg = useMemo(() => {
    if (orderType === 'market' && marketClosed) {
      return 'Market is closed: use Limit for after-hours equities; options require regular session.';
    }
    if (extended && !allowsExtended) return 'Options do not support extended-hours orders.';
    return null;
  }, [orderType, marketClosed, extended, allowsExtended]);

  async function submit() {
    setStatus(null);
    const sym = symbol || '';
    if (!sym) return setStatus({ type: 'error', msg: 'Select a symbol first' });

    const qtyN = toNum(qty);
    const notionalN = toNum(notional);
    if (useNotional) {
      if (notionalN == null || notionalN <= 0) return setStatus({ type: 'error', msg: 'Enter a valid notional' });
    } else if (qtyN == null || qtyN <= 0) {
      return setStatus({ type: 'error', msg: 'Enter a valid quantity' });
    }

    if (showLimit && (toNum(limitPrice) == null || toNum(limitPrice) <= 0)) {
      return setStatus({ type: 'error', msg: 'Limit price must be > 0' });
    }
    if (showStop && (toNum(stopPrice) == null || toNum(stopPrice) <= 0)) {
      return setStatus({ type: 'error', msg: 'Stop price must be > 0' });
    }
    if (showTrailing && toNum(trailPrice) != null && toNum(trailPercent) != null) {
      return setStatus({ type: 'error', msg: 'Use only one of trail price or trail percent' });
    }

    if (orderType === 'market' && marketClosed) {
      return setStatus({ type: 'error', msg: precheckMsg });
    }

    const payload = {
      symbol: sym,
      side,
      order_type: orderType,
      time_in_force: tif,
      order_class: orderClass,
      extended_hours: !!extended,
      client_order_id: clientOrderId || undefined,
      qty: useNotional ? undefined : qtyN,
      notional: useNotional ? notionalN : undefined,
      limit_price: showLimit ? toNum(limitPrice) : undefined,
      stop_price: showStop ? toNum(stopPrice) : undefined,
      trail_price: showTrailing ? toNum(trailPrice) : undefined,
      trail_percent: showTrailing ? toNum(trailPercent) : undefined,
      take_profit_limit_price: usingBracket ? toNum(tp) : undefined,
      stop_loss_stop_price: usingBracket ? toNum(slStop) : undefined,
      stop_loss_limit_price: usingBracket ? toNum(slLimit) : undefined,
    };

    try {
      const o = await submitOrder(payload);
      setStatus({ type: 'success', msg: `${side.toUpperCase()} ${orderType} submitted (${o.status || 'accepted'})` });
      setQty('');
      setNotional('');
      setClientOrderId('');
    } catch (e) {
      setStatus({ type: 'error', msg: e.message });
    }
  }

  return (
    <div style={s.card}>
      <button
        type="button"
        style={s.header}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={expanded ? 'Collapse order panel' : 'Expand order panel'}
      >
        <span style={s.headerTitle}>Place Order {symbol ? `— ${symbol}` : ''}</span>
        <span style={s.headerChevron} aria-hidden>{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        <>
      <div style={s.sideTabs}>
        <button style={s.sideTab(side === 'buy', 'buy')} onClick={() => setSide('buy')}>Buy</button>
        <button style={s.sideTab(side === 'sell', 'sell')} onClick={() => setSide('sell')}>Sell</button>
      </div>

      <div style={s.tabs}>
        {ORDER_TYPES.map((t) => (
          <button key={t} style={s.tab(orderType === t)} onClick={() => setOrderType(t)}>
            {t.replace('_', ' ')}
          </button>
        ))}
      </div>

      {precheckMsg && <div style={s.info}>{precheckMsg}</div>}

      <div style={s.row2}>
        <label style={s.label}>Order Class
          <select style={s.input} value={orderClass} onChange={(e) => setOrderClass(e.target.value)}>
            {ORDER_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={s.label}>TIF
          <select style={s.input} value={tif} onChange={(e) => setTif(e.target.value)}>
            {['day', 'gtc', 'ioc', 'fok'].map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}
          </select>
        </label>
      </div>

      <div style={s.row2}>
        <label style={s.label}>Sizing
          <select style={s.input} value={useNotional ? 'notional' : 'qty'} onChange={(e) => setUseNotional(e.target.value === 'notional')}>
            <option value="qty">Quantity</option>
            <option value="notional">Notional ($)</option>
          </select>
        </label>
        {!opt && (
          <label style={{ ...s.label, display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 }}>
            <input type="checkbox" checked={extended} onChange={(e) => setExtended(e.target.checked)} />
            Extended hours
          </label>
        )}
      </div>

      {useNotional ? (
        <>
          <div style={s.label}>Notional ($)</div>
          <input style={s.input} type="number" min="1" step="1" value={notional} onChange={(e) => setNotional(e.target.value)} />
        </>
      ) : (
        <>
          <div style={s.label}>{opt ? 'Contracts (whole)' : 'Quantity (shares)'}</div>
          <input style={s.input} type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} />
        </>
      )}

      {showLimit && (
        <>
          <div style={s.label}>Limit Price ($)</div>
          <input style={s.input} type="number" min="0.01" step="0.01" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} />
        </>
      )}
      {showStop && (
        <>
          <div style={s.label}>Stop Price ($)</div>
          <input style={s.input} type="number" min="0.01" step="0.01" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} />
        </>
      )}
      {showTrailing && (
        <div style={s.row2}>
          <div>
            <div style={s.label}>Trail Price ($)</div>
            <input style={s.input} type="number" min="0.01" step="0.01" value={trailPrice} onChange={(e) => setTrailPrice(e.target.value)} />
          </div>
          <div>
            <div style={s.label}>Trail Percent (%)</div>
            <input style={s.input} type="number" min="0.01" step="0.01" value={trailPercent} onChange={(e) => setTrailPercent(e.target.value)} />
          </div>
        </div>
      )}

      {usingBracket && (
        <>
          <div style={s.row2}>
            <div>
              <div style={s.label}>Take Profit Limit ($)</div>
              <input style={s.input} type="number" min="0.01" step="0.01" value={tp} onChange={(e) => setTp(e.target.value)} />
            </div>
            <div>
              <div style={s.label}>Stop Loss Stop ($)</div>
              <input style={s.input} type="number" min="0.01" step="0.01" value={slStop} onChange={(e) => setSlStop(e.target.value)} />
            </div>
          </div>
          <div style={s.label}>Stop Loss Limit ($, optional)</div>
          <input style={s.input} type="number" min="0.01" step="0.01" value={slLimit} onChange={(e) => setSlLimit(e.target.value)} />
        </>
      )}

      <div style={s.label}>Client Order ID (optional)</div>
      <input style={s.input} value={clientOrderId} onChange={(e) => setClientOrderId(e.target.value)} />

      {buyingPower != null && (
        <div style={{ ...s.label, marginBottom: 12 }}>
          Buying power: <span style={{ color: 'var(--text-primary)' }}>${Number(buyingPower).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
        </div>
      )}

      <button style={s.submitBtn(side)} onClick={submit}>
        Submit {side === 'buy' ? 'Buy' : 'Sell'}
      </button>

      {status && <div style={status.type === 'error' ? s.error : s.success}>{status.msg}</div>}
        </>
      )}
    </div>
  );
}
