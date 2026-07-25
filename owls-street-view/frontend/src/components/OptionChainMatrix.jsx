import React from 'react';

const hdr = {
  background: 'var(--bg-input)',
  color: 'var(--text-secondary)',
  fontSize: 10,
  fontWeight: 600,
  padding: '6px 4px',
  textAlign: 'right',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
};

const hdrStrike = { ...hdr, textAlign: 'center', color: 'var(--accent)' };
const hdrGroup = {
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: 10,
  fontWeight: 700,
  padding: '8px 4px',
  textAlign: 'center',
  borderBottom: '1px solid var(--border)',
};

const cell = {
  fontSize: 11,
  padding: '4px 4px',
  textAlign: 'right',
  borderBottom: '1px solid var(--border-subtle)',
  fontVariantNumeric: 'tabular-nums',
  cursor: 'pointer',
  color: 'var(--text-primary)',
};

const cellStrike = {
  ...cell,
  textAlign: 'center',
  fontWeight: 700,
  color: 'var(--accent)',
  cursor: 'default',
};

function fmt(n, d = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toFixed(d);
}

function fmtSz(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const x = Number(n);
  if (x >= 1000) return `${(x / 1000).toFixed(1)}k`;
  return x.toFixed(0);
}

function LegCells({ leg, side, onPick, selectedSymbol }) {
  if (!leg) {
    return Array.from({ length: 10 }, (_, i) => (
      <td key={`e-${side}-${i}`} style={{ ...cell, color: 'var(--text-muted)', cursor: 'default' }}>
        —
      </td>
    ));
  }
  const sel = selectedSymbol === leg.symbol;
  const c = { ...cell, background: sel ? 'var(--bg-muted)' : undefined };
  const mk = (v, d = 2, key) => (
    <td key={key} style={c} title={leg.symbol} onClick={() => onPick(leg.symbol)}>
      {fmt(v, d)}
    </td>
  );
  if (side === 'call') {
    return (
      <>
        {mk(leg.iv_pct, 1, 'iv')}
        {mk(leg.delta, 3, 'de')}
        {mk(leg.gamma, 4, 'ga')}
        {mk(leg.theta, 3, 'th')}
        {mk(leg.vega, 3, 've')}
        {mk(leg.bid, 2, 'bi')}
        {mk(leg.ask, 2, 'as')}
        {mk(leg.mid, 2, 'mi')}
        {mk(leg.last, 2, 'lt')}
        <td style={c} onClick={() => onPick(leg.symbol)} title={leg.symbol}>
          {fmtSz(leg.last_size)}
        </td>
      </>
    );
  }
  return (
    <>
      <td style={c} onClick={() => onPick(leg.symbol)} title={leg.symbol}>
        {fmtSz(leg.last_size)}
      </td>
      {mk(leg.last, 2, 'lt')}
      {mk(leg.mid, 2, 'mi')}
      {mk(leg.ask, 2, 'as')}
      {mk(leg.bid, 2, 'bi')}
      {mk(leg.vega, 3, 've')}
      {mk(leg.theta, 3, 'th')}
      {mk(leg.gamma, 4, 'ga')}
      {mk(leg.delta, 3, 'de')}
      {mk(leg.iv_pct, 1, 'iv')}
    </>
  );
}

export default function OptionChainMatrix({ data, selectedSymbol, onPickContract }) {
  if (!data?.strikes?.length) return null;

  const { underlying, expiration, spot, vix, strikes } = data;
  const spotN = spot != null ? Number(spot) : null;
  let nearest = null;
  let best = Infinity;
  if (spotN != null) {
    strikes.forEach((r) => {
      const d = Math.abs(Number(r.strike) - spotN);
      if (d < best) {
        best = d;
        nearest = Number(r.strike);
      }
    });
  }

  const callHdr = ['IV%', 'Δ', 'Γ', 'Θ', 'Vega', 'Bid', 'Ask', 'Mid', 'Last', 'Sz'];
  const putHdr = ['Sz', 'Last', 'Mid', 'Ask', 'Bid', 'Vega', 'Θ', 'Γ', 'Δ', 'IV%'];

  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 14,
          alignItems: 'center',
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '10px 12px',
          marginBottom: 8,
          fontSize: 12,
        }}
      >
        <span>
          <span style={{ color: 'var(--text-secondary)' }}>{underlying}</span>
          {spotN != null && (
            <>
              {' '}
              spot <b style={{ color: 'var(--text-primary)' }}>{fmt(spotN, 2)}</b>
            </>
          )}
        </span>
        {vix && (
          <span style={{ borderLeft: '1px solid var(--border)', paddingLeft: 14 }}>
            <span style={{ color: 'var(--text-secondary)' }}>{vix.label}</span> ({vix.symbol}){' '}
            <b style={{ color: 'var(--warning)' }}>
              {vix.last != null ? fmt(vix.last, 2) : vix.mid != null ? fmt(vix.mid, 2) : '—'}
            </b>
            {vix.bid != null && vix.ask != null && (
              <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                {fmt(vix.bid, 2)} × {fmt(vix.ask, 2)}
              </span>
            )}
          </span>
        )}
        <span style={{ color: 'var(--text-muted)' }}>
          Exp <b style={{ color: 'var(--text-primary)' }}>{expiration}</b> · {strikes.length} strikes
        </span>
      </div>

      <div style={{ overflowX: 'auto', maxHeight: 440, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <tr>
              <th colSpan={10} style={{ ...hdrGroup, borderRight: '1px solid var(--border)' }}>
                CALLS →
              </th>
              <th style={{ ...hdrGroup, minWidth: 72 }}>Strike</th>
              <th colSpan={10} style={{ ...hdrGroup, borderLeft: '1px solid var(--border)' }}>
                ← PUTS
              </th>
            </tr>
            <tr>
              {callHdr.map((h) => (
                <th key={`c-${h}`} style={{ ...hdr, borderRight: h === 'Sz' ? '1px solid var(--border)' : undefined }}>
                  {h}
                </th>
              ))}
              <th style={hdrStrike}>Strike</th>
              {putHdr.map((h) => (
                <th key={`p-${h}`} style={{ ...hdr, borderLeft: h === 'Sz' ? '1px solid var(--border)' : undefined }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {strikes.map((row) => {
              const k = Number(row.strike);
              const atm = nearest != null && k === nearest;
              const rowBg = atm ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : undefined;
              return (
                <tr key={k} style={{ background: rowBg }}>
                  <LegCells leg={row.call} side="call" onPick={onPickContract} selectedSymbol={selectedSymbol} />
                  <td style={{ ...cellStrike, background: rowBg }}>{fmt(k, k >= 1000 ? 1 : 2)}</td>
                  <LegCells leg={row.put} side="put" onPick={onPickContract} selectedSymbol={selectedSymbol} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
        Click a call/put cell to trade or chart that contract. IV shown as %. LTP = last trade.
        {vix == null && ' VIX row hidden if no VIX/VIXY/VXX snapshot on your feed.'}
      </div>
    </div>
  );
}
