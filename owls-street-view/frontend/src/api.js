const BASE = '/api';

function formatApiError(body, fallback) {
  const d = body?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    return d
      .map((x) => (x && typeof x === 'object' && x.msg != null ? String(x.msg) : JSON.stringify(x)))
      .join('; ');
  }
  if (d && typeof d === 'object' && d.msg != null) return String(d.msg);
  if (body?.message) return String(body.message);
  return fallback || 'Request failed';
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatApiError(err, res.statusText));
  }
  return res.json();
}

export const getAccount = () => request('/account');
export const getClock = () => request('/clock');
export const getPositions = () => request('/positions');
export const getOrders = (status = 'open', limit = 100) =>
  request(`/orders?status=${status}&limit=${limit}`);
export const cancelOrder = (id) => request(`/orders/${id}`, { method: 'DELETE' });
export const closePosition = (symbol, qty) =>
  request('/positions/close', {
    method: 'POST',
    body: JSON.stringify(
      qty != null && Number(qty) > 0 ? { symbol, qty: Number(qty) } : { symbol },
    ),
  });
export const getSnapshot = (symbol) => request(`/snapshot/${symbol}`);

/** @param {Record<string, unknown>} payload */
export const runScreener = (payload) =>
  request('/screener', { method: 'POST', body: JSON.stringify(payload) });
export const getBars = (symbol, timeframe = '1D', opts = {}) => {
  const params = new URLSearchParams();
  params.set('timeframe', timeframe);
  if (opts.start) params.set('start', opts.start);
  if (opts.end) params.set('end', opts.end);
  if (opts.limit != null) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return request(`/bars/${encodeURIComponent(symbol)}?${qs}`);
};

export const getOptionExpirations = (underlying, horizonDays = 548) => {
  const q = new URLSearchParams();
  if (horizonDays != null) q.set('horizon_days', String(horizonDays));
  const qs = q.toString();
  return request(`/option-expirations/${encodeURIComponent(underlying)}${qs ? `?${qs}` : ''}`);
};

export const getOptionChainMatrix = (underlying, expirationDate, opts = {}) => {
  const { wing, centerStrike } = opts;
  const params = new URLSearchParams();
  params.set('expiration_date', expirationDate);
  if (wing != null) params.set('wing', String(wing));
  if (centerStrike != null) params.set('center_strike', String(centerStrike));
  return request(
    `/option-chain-matrix/${encodeURIComponent(underlying)}?${params.toString()}`,
  );
};

export const getOptionChain = (underlying, opts = {}) => {
  const { expirationDate, contractType, limit } = opts;
  const params = new URLSearchParams();
  if (expirationDate) params.set('expiration_date', expirationDate);
  if (contractType) params.set('contract_type', contractType);
  if (limit != null) params.set('limit', String(limit));
  const q = params.toString();
  const path = `/option-chain/${encodeURIComponent(underlying)}${q ? `?${q}` : ''}`;
  return request(path);
};

export const placeMarketOrder = (symbol, qty, side) =>
  request('/orders/market', { method: 'POST', body: JSON.stringify({ symbol, qty, side }) });

export const placeLimitOrder = (symbol, qty, side, limit_price) =>
  request('/orders/limit', { method: 'POST', body: JSON.stringify({ symbol, qty, side, limit_price }) });

export const submitOrder = (payload) =>
  request('/orders/submit', { method: 'POST', body: JSON.stringify(payload) });

export const getOrderDetail = (orderId, nested = true) =>
  request(`/orders/${encodeURIComponent(orderId)}?nested=${nested ? 'true' : 'false'}`);

export const replaceOrder = (orderId, payload) =>
  request(`/orders/${encodeURIComponent(orderId)}`, { method: 'PATCH', body: JSON.stringify(payload) });

export function createQuoteSocket(symbols, onMessage) {
  const wsScheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${wsScheme}://${window.location.host}/ws/quotes`;
  const ws = new WebSocket(wsUrl);
  ws.onopen = () => ws.send(JSON.stringify({ action: 'subscribe', symbols }));
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onerror = (e) => console.error('WebSocket error', e);
  return ws;
}
