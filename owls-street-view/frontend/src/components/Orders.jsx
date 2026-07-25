import React, { useEffect, useState } from 'react';
import { cancelOrder, getOrderDetail, getOrders, replaceOrder } from '../api';

const s = {
  card: { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' },
  title: { fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' },
  tabs: { display: 'flex', gap: 4 },
  tab: (active) => ({
    padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12,
    background: active ? 'var(--bg-elevated)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
  }),
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { padding: '8px 16px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 500, fontSize: 12 },
  td: { padding: '10px 16px', borderTop: '1px solid var(--border-subtle)', color: 'var(--text-primary)' },
  empty: { padding: 32, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 },
  btn: {
    background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)',
    borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11,
  },
  dangerBtn: {
    background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)',
    borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11,
  },
  detailCard: { background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 },
  statusBadge: (status) => {
    const colors = {
      filled: 'var(--success)', partially_filled: 'var(--warning)', canceled: 'var(--text-secondary)',
      new: 'var(--accent)', accepted: 'var(--accent)', pending_new: 'var(--accent)',
      held: 'var(--warning)', pending_cancel: 'var(--warning)', pending_replace: 'var(--warning)',
      pending_review: 'var(--warning)', accepted_for_bidding: 'var(--accent)',
    };
    return { color: colors[status] || 'var(--text-primary)', fontSize: 12 };
  },
};

function orderMayCancel(status) {
  const x = normalizeEnum(status);
  return !['filled', 'canceled', 'expired', 'rejected', 'replaced', 'calculated', 'stopped', 'suspended', 'done_for_day'].includes(x);
}

function orderMayReplace(status) {
  const x = normalizeEnum(status);
  return ['new', 'accepted', 'pending_new', 'partially_filled', 'held', 'accepted_for_bidding'].includes(x);
}

function normalizeEnum(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const token = raw.includes('.') ? raw.split('.').pop() : raw;
  return token.toLowerCase();
}

function labelFromEnum(value) {
  const norm = normalizeEnum(value);
  if (!norm) return '—';
  const friendly = { accepted: 'Pending', pending_new: 'Pending', accepted_for_bidding: 'Pending' };
  if (friendly[norm]) return friendly[norm];
  return norm.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function n(v) {
  if (v === '' || v == null) return undefined;
  const num = Number(v);
  return Number.isFinite(num) ? num : undefined;
}

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('open');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [openOrderId, setOpenOrderId] = useState(null);
  const [orderDetail, setOrderDetail] = useState(null);
  const [replaceForm, setReplaceForm] = useState({ qty: '', limit_price: '', stop_price: '', trail: '', time_in_force: '' });

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setOrders(await getOrders(filter));
    } catch (e) {
      setLoadError(e.message || 'Failed to load orders');
      setOrders([]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [filter]);

  async function handleCancel(id) {
    try { await cancelOrder(id); load(); } catch (e) { alert(e.message); }
  }

  async function toggleDetails(id) {
    if (openOrderId === id) {
      setOpenOrderId(null);
      setOrderDetail(null);
      return;
    }
    setOpenOrderId(id);
    setOrderDetail(null);
    try {
      const d = await getOrderDetail(id, true);
      setOrderDetail(d);
      setReplaceForm({
        qty: d.qty ?? '',
        limit_price: d.limit_price ?? '',
        stop_price: d.stop_price ?? '',
        trail: d.trail_price ?? d.trail_percent ?? '',
        time_in_force: (d.time_in_force || '').toLowerCase(),
      });
    } catch (e) {
      setOrderDetail({ error: e.message });
    }
  }

  async function submitReplace(id) {
    const payload = {
      qty: n(replaceForm.qty),
      limit_price: n(replaceForm.limit_price),
      stop_price: n(replaceForm.stop_price),
      trail: n(replaceForm.trail),
      time_in_force: replaceForm.time_in_force || undefined,
    };
    try {
      await replaceOrder(id, payload);
      await toggleDetails(id);
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div style={s.card}>
      <div style={s.topBar}>
        <div style={s.title}>Orders</div>
        <div style={s.tabs}>
          {['open', 'closed', 'all'].map((f) => (
            <button key={f} style={s.tab(filter === f)} onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div style={s.empty}>Loading…</div>
      ) : loadError ? (
        <div style={{ ...s.empty, color: 'var(--danger)' }}>{loadError}</div>
      ) : orders.length === 0 ? (
        <div style={s.empty}>No {filter} orders</div>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Symbol</th>
              <th style={s.th}>Side</th>
              <th style={s.th}>Type</th>
              <th style={s.th}>Qty</th>
              <th style={s.th}>Filled</th>
              <th style={s.th}>Limit</th>
              <th style={s.th}>Status</th>
              <th style={s.th}>Time</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <React.Fragment key={o.id}>
                <tr>
                  <td style={{ ...s.td, fontWeight: 600 }}>{o.symbol}</td>
                  <td style={{ ...s.td, color: normalizeEnum(o.side) === 'buy' ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                    {labelFromEnum(o.side)}
                  </td>
                  <td style={s.td}>{labelFromEnum(o.type)}</td>
                  <td style={s.td}>{o.qty ?? '—'}</td>
                  <td style={s.td}>{o.filled_qty ?? 0}</td>
                  <td style={s.td}>{o.limit_price ? `$${o.limit_price}` : '—'}</td>
                  <td style={s.td}><span style={s.statusBadge(normalizeEnum(o.status))}>{labelFromEnum(o.status)}</span></td>
                  <td style={{ ...s.td, color: 'var(--text-secondary)', fontSize: 12 }}>{o.created_at ? new Date(o.created_at).toLocaleString() : '—'}</td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" style={s.btn} onClick={() => toggleDetails(o.id)}>Details</button>
                      {orderMayReplace(o.status) && <button type="button" style={s.btn} onClick={() => toggleDetails(o.id)}>Replace</button>}
                      {orderMayCancel(o.status) && <button type="button" style={s.dangerBtn} onClick={() => handleCancel(o.id)}>Cancel</button>}
                    </div>
                  </td>
                </tr>
                {openOrderId === o.id && (
                  <tr>
                    <td style={s.td} colSpan={9}>
                      <div style={s.detailCard}>
                        {orderDetail?.error ? (
                          <div style={{ color: 'var(--danger)' }}>{orderDetail.error}</div>
                        ) : !orderDetail ? (
                          <div style={{ color: 'var(--text-secondary)' }}>Loading details…</div>
                        ) : (
                          <>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginBottom: 10 }}>
                              <div><div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Order Class</div><div>{labelFromEnum(orderDetail.order_class)}</div></div>
                              <div><div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>TIF</div><div>{labelFromEnum(orderDetail.time_in_force)}</div></div>
                              <div><div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Stop</div><div>{orderDetail.stop_price ?? '—'}</div></div>
                              <div><div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Trail</div><div>{orderDetail.trail_price ?? orderDetail.trail_percent ?? '—'}</div></div>
                            </div>
                            {orderDetail.legs?.length > 0 && (
                              <div style={{ marginBottom: 10, color: 'var(--text-secondary)', fontSize: 12 }}>
                                Legs: {orderDetail.legs.map((l) => `${labelFromEnum(l.side)} ${labelFromEnum(l.type)} (${labelFromEnum(l.status)})`).join(' | ')}
                              </div>
                            )}
                            {orderMayReplace(orderDetail.status) && (
                              <div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginBottom: 6 }}>Replace Order</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
                                  <input style={{ ...s.btn, padding: '6px 8px' }} placeholder="Qty" value={replaceForm.qty} onChange={(e) => setReplaceForm((p) => ({ ...p, qty: e.target.value }))} />
                                  <input style={{ ...s.btn, padding: '6px 8px' }} placeholder="Limit" value={replaceForm.limit_price} onChange={(e) => setReplaceForm((p) => ({ ...p, limit_price: e.target.value }))} />
                                  <input style={{ ...s.btn, padding: '6px 8px' }} placeholder="Stop" value={replaceForm.stop_price} onChange={(e) => setReplaceForm((p) => ({ ...p, stop_price: e.target.value }))} />
                                  <input style={{ ...s.btn, padding: '6px 8px' }} placeholder="Trail" value={replaceForm.trail} onChange={(e) => setReplaceForm((p) => ({ ...p, trail: e.target.value }))} />
                                  <select style={{ ...s.btn, padding: '6px 8px' }} value={replaceForm.time_in_force} onChange={(e) => setReplaceForm((p) => ({ ...p, time_in_force: e.target.value }))}>
                                    <option value="">TIF</option>
                                    <option value="day">DAY</option>
                                    <option value="gtc">GTC</option>
                                    <option value="ioc">IOC</option>
                                    <option value="fok">FOK</option>
                                  </select>
                                </div>
                                <div style={{ marginTop: 8 }}>
                                  <button type="button" style={s.btn} onClick={() => submitReplace(o.id)}>Submit Replace</button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
