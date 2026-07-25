import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  useId,
} from 'react';
import {
  ColorType,
  CrosshairMode,
  createChart,
} from 'lightweight-charts';
import {
  getBars,
  getSnapshot,
  submitOrder,
  getOptionExpirations,
  getOptionChain,
  createQuoteSocket,
} from '../api';
import { isOptionSymbol } from '../symbols';
import {
  barTimeSeconds,
  seriesATR,
  seriesBollinger,
  seriesDonchian,
  seriesEMA,
  seriesMACD,
  seriesRSI,
  seriesSMA,
  seriesVWAP,
  seriesWMA,
  chartMacdHistogramSignalMarkers,
} from '../utils/indicators';
import { formatEtLabel, timeframeLabel, TIMEFRAMES } from './chart/formatters';
import {
  loadDrawingsForSymbol,
  newDrawingId,
  persistDrawings,
  loadAllChartAlerts,
  persistAllChartAlerts,
  newChartAlertId,
} from './chart/storage';
import {
  CHART_ALERT_TYPES,
  evaluateAllChartAlerts,
  formatChartAlertSummary,
  chartAlertTypeMeta,
} from './chart/alertEngine';

const CANDLE_BAR_SPACING_DEFAULT = 12;
const CANDLE_BAR_SPACING_MIN = 6;
const CANDLE_BAR_SPACING_MAX = 30;

const BAR_PAGE_LIMIT = 5000;
const MAX_CACHED_BARS = 25000;
const LIVE_POLL_LIMIT = 1200;

/** Sliding history windows per timeframe preset (used for incremental paging). */
const HISTORY_PAGE_MS = {
  '1MIN': 45 * 24 * 60 * 60 * 1000,
  '5MIN': 120 * 24 * 60 * 60 * 1000,
  '10MIN': 180 * 24 * 60 * 60 * 1000,
  '15MIN': 240 * 24 * 60 * 60 * 1000,
  '1H': 365 * 24 * 60 * 60 * 1000,
  '5H': 730 * 24 * 60 * 60 * 1000,
  '1D': 14 * 24 * 60 * 60 * 1000,
  '5D': 120 * 24 * 60 * 60 * 1000,
  '1M': 365 * 24 * 60 * 60 * 1000,
  '3M': 3 * 365 * 24 * 60 * 60 * 1000,
  '1Y': 10 * 365 * 24 * 60 * 60 * 1000,
  '5Y': 30 * 365 * 24 * 60 * 60 * 1000,
};

function livePollMsForTimeframe(tf) {
  switch (tf) {
    case '1MIN':
      return 5000;
    case '5MIN':
    case '10MIN':
    case '15MIN':
      return 7000;
    case '1H':
    case '5H':
      return 10000;
    case '1D':
    case '5D':
      return 15000;
    default:
      return 20000;
  }
}

function candleIntervalMs(tf) {
  switch (tf) {
    case '1MIN':
      return 60_000;
    case '5MIN':
      return 5 * 60_000;
    case '10MIN':
      return 10 * 60_000;
    case '15MIN':
      return 15 * 60_000;
    case '1H':
      return 60 * 60_000;
    case '5H':
      return 5 * 60 * 60_000;
    case '1D':
      return 24 * 60 * 60_000;
    case '5D':
      return 5 * 24 * 60 * 60_000;
    case '1M':
      return 30 * 24 * 60 * 60_000;
    case '3M':
      return 90 * 24 * 60 * 60_000;
    case '1Y':
      return 365 * 24 * 60 * 60_000;
    case '5Y':
      return 5 * 365 * 24 * 60 * 60_000;
    default:
      return 60_000;
  }
}

function barTimeMs(bar) {
  return new Date(bar.time).getTime();
}

function mergeBarsUnique(prev, incoming) {
  if (!incoming.length) return prev;
  const map = new Map();
  for (const b of prev) map.set(barTimeSeconds(b), b);
  for (const b of incoming) map.set(barTimeSeconds(b), b);
  const merged = Array.from(map.values());
  merged.sort((a, b) => barTimeMs(a) - barTimeMs(b));
  if (merged.length > MAX_CACHED_BARS) return merged.slice(0, MAX_CACHED_BARS);
  return merged;
}

function barsEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (!x || !y) return false;
    if (x.time !== y.time) return false;
    if (Number(x.open) !== Number(y.open)) return false;
    if (Number(x.high) !== Number(y.high)) return false;
    if (Number(x.low) !== Number(y.low)) return false;
    if (Number(x.close) !== Number(y.close)) return false;
    if (Number(x.volume) !== Number(y.volume)) return false;
  }
  return true;
}

/**
 * Run after the current layout / ResizeObserver cycle so we do not trigger
 * "ResizeObserver loop completed with undelivered notifications" (CRA may surface it as a runtime error).
 */
function deferAfterLayout(fn) {
  if (typeof requestAnimationFrame === 'undefined') {
    setTimeout(fn, 0);
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(fn);
  });
}


const DRAW_TOOLS = {
  pan: 'pan',
  line: 'line',
  arrow: 'arrow',
  hline: 'hline',
  text: 'text',
  box: 'box',
  marker: 'marker',
};

const CHART_LAYOUT = {
  normal: 'normal',
  minimized: 'minimized',
  expanded: 'expanded',
};

const IND_INIT = {
  volume: true,
  sma9: false,
  sma20: true,
  wma20: false,
  sma50: false,
  sma100: false,
  sma200: false,
  ema12: false,
  ema26: false,
  ema50: false,
  ema200: false,
  bb: false,
  donchian: false,
  vwap: false,
  atr14: false,
  rsi: false,
  macd: false,
  tradeSignals: true,
};

const CHART_TYPE_OPTIONS = [
  ['candles', 'Candles'],
  ['hollow', 'Hollow candles'],
  ['heikin', 'Heikin-Ashi'],
  ['bars', 'Bars'],
  ['line', 'Line'],
  ['area', 'Area'],
];

const HEDGE_STRATEGIES = {
  protective_put: 'Protective Put',
  covered_call: 'Covered Call',
  collar: 'Collar',
};

const s = {
  wrapper: {
    background: 'linear-gradient(180deg, var(--surface-grad-top), var(--surface-grad-bot)), var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 16,
    boxShadow: 'var(--shadow-card)',
  },
  topRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 12 },
  symbolName: { fontSize: 22, fontWeight: 700 },
  priceRow: { display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 },
  currentPrice: { fontSize: 28, fontWeight: 600 },
  changeBadge: (pct) => ({
    fontSize: 13, padding: '2px 8px', borderRadius: 4,
    background: pct >= 0 ? 'var(--bg-success-soft)' : 'var(--bg-danger-soft)',
    color: pct >= 0 ? 'var(--success)' : 'var(--danger)',
  }),
  tfRow: { display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' },
  tfBtn: (active) => ({
    padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12,
    background: active ? 'var(--accent-strong)' : 'var(--border-subtle)',
    color: active ? 'var(--accent-contrast)' : 'var(--text-secondary)',
    boxShadow: active ? 'var(--shadow-soft)' : 'none',
    transition: 'all 140ms ease',
  }),
  layoutBtn: (active) => ({
    padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 11,
    background: active ? 'var(--border)' : 'transparent',
    color: 'var(--text-secondary)',
    transition: 'all 140ms ease',
  }),
  fullScreenBtn: {
    padding: '8px 18px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    background: 'var(--accent-strong)',
    color: 'var(--accent-contrast)',
    boxShadow: '0 2px 8px var(--shadow-accent)',
    transition: 'all 140ms ease',
  },
  fullScreenHint: { fontSize: 11, color: 'var(--text-secondary)', marginLeft: 8 },
  toolBtn: (active) => ({
    padding: '4px 10px', borderRadius: 6, border: '1px solid transparent', cursor: 'pointer', fontSize: 11,
    background: active ? 'var(--success)' : 'var(--border-subtle)',
    color: active ? 'var(--accent-contrast)' : 'var(--text-primary)',
    boxShadow: active ? 'var(--shadow-soft)' : 'none',
    transition: 'all 140ms ease',
  }),
  actionBtn: {
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontSize: 11,
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    transition: 'all 140ms ease',
  },
  toolsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 4,
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '8px 10px',
    boxShadow: 'var(--shadow-soft)',
  },
  toolsGroup: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  toolsDivider: { width: 1, height: 18, background: 'var(--border)' },
  toolsLabel: { fontSize: 11, color: 'var(--text-muted)', marginRight: 4 },
  ohlc: { display: 'flex', gap: 16, marginBottom: 10, fontSize: 12, color: 'var(--text-secondary)', flexWrap: 'wrap' },
  ohlcVal: { color: 'var(--text-primary)', fontWeight: 500 },
  panel: {
    background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 10, boxShadow: 'var(--shadow-soft)',
  },
  panelHead: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
    fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', userSelect: 'none',
  },
  gridChecks: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '6px 12px', marginTop: 10 },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-primary)', cursor: 'pointer' },
  chartStack: { position: 'relative', width: '100%', minHeight: 0 },
  chartHost: { width: '100%', height: '100%', minHeight: 0, position: 'relative' },
  subHost: { width: '100%', height: 120, marginTop: 4 },
  empty: { height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' },
  foot: { fontSize: 10, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 },
  minimizedBar: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--bg-input)',
    borderRadius: 6, border: '1px solid var(--border)', boxShadow: 'var(--shadow-soft)',
  },
};

function buildCandles(bars) {
  const mapped = bars.map((b) => ({
    time: barTimeSeconds(b),
    open: Number(b.open),
    high: Number(b.high),
    low: Number(b.low),
    close: Number(b.close),
  }));
  mapped.sort((a, b) => a.time - b.time);
  const out = [];
  let lastT = null;
  for (const c of mapped) {
    if (c.time === lastT) out[out.length - 1] = c;
    else out.push(c);
    lastT = c.time;
  }
  return out;
}

/** Keep sub-panes aligned with main when user pans/zooms main. */
function syncCharts(main, others) {
  if (!others.length) return;
  main.timeScale().subscribeVisibleTimeRangeChange((range) => {
    if (range === null) return;
    others.forEach((c) => {
      try {
        c.timeScale().setVisibleRange(range);
      } catch (_) {}
    });
  });
}

/**
 * The pane's top canvas (z-index above series canvas) receives pointer events.
 * Time scale X and series Y are in this canvas's client coordinate space — not the outer chart div.
 */
function getMainPaneInteractionCanvas(chart) {
  const root = chart?.chartElement?.();
  if (!root) return null;
  const paneTd =
    root.querySelector('table tr:first-child td:nth-child(2)')
    ?? root.querySelector('table tr td:nth-child(2)');
  const paneWrapper = paneTd?.firstElementChild;
  if (paneWrapper) {
    const list = paneWrapper.querySelectorAll('canvas');
    if (list.length >= 2) return list[list.length - 1];
    if (list.length === 1) return list[0];
  }
  const table = root.querySelector('table');
  const row = table?.rows?.[0];
  const paneCell = row?.cells?.[1];
  const wrap2 = paneCell?.firstElementChild;
  if (wrap2) {
    const list = wrap2.querySelectorAll('canvas');
    if (list.length >= 2) return list[list.length - 1];
    if (list.length === 1) return list[0];
  }
  /** Fallback if table layout changes: largest main-looking canvas inside the chart. */
  const canvases = Array.from(root.querySelectorAll('canvas'));
  let best = null;
  let bestArea = 0;
  for (const c of canvases) {
    const r = c.getBoundingClientRect();
    const area = r.width * r.height;
    if (r.width > 80 && r.height > 80 && area > bestArea) {
      best = c;
      bestArea = area;
    }
  }
  return best;
}

function timeKey(t) {
  if (t == null) return '';
  if (typeof t === 'number' || typeof t === 'string') return String(t);
  if (typeof t === 'object' && t !== null && 'year' in t && 'month' in t && 'day' in t) {
    return `${t.year}-${t.month}-${t.day}`;
  }
  return String(t);
}

function drawingMovedEnough(clientX0, clientY0, clientX1, clientY1, minPx = 6) {
  return Math.hypot(clientX1 - clientX0, clientY1 - clientY0) >= minPx;
}

/** Map viewport pixels to time/price using Lightweight Charts pane coordinates. */
function logicalFromPixel(chart, series, clientX, clientY) {
  if (!chart || !series) return null;
  const canvas = getMainPaneInteractionCanvas(chart);
  if (!canvas) return null;
  const r = canvas.getBoundingClientRect();
  const tw = chart.timeScale().width();
  if (!Number.isFinite(tw) || tw <= 0) return null;
  let x = clientX - r.left;
  let y = clientY - r.top;
  x = Math.max(0, Math.min(x, tw - 1e-6));
  y = Math.max(0, Math.min(y, Math.max(r.height - 1e-6, 0)));
  const t = chart.timeScale().coordinateToTime(x);
  const p = series.coordinateToPrice(y);
  if (t == null || p == null) return null;
  const price = typeof p === 'number' ? p : Number(p);
  if (!Number.isFinite(price)) return null;
  return { time: t, price };
}

/** Short horizontal trend line from a context-menu anchor (time moves ~80px right, same price). */
function buildShortTrendLine(chart, hit, deltaX = 88) {
  if (!chart || !hit) return null;
  const x1 = chart.timeScale().timeToCoordinate(hit.time);
  if (x1 == null) return null;
  const t2 = chart.timeScale().coordinateToTime(Math.min(x1 + deltaX, chart.timeScale().width() - 1e-6));
  if (t2 == null) return null;
  return { t1: hit.time, p1: hit.price, t2, p2: hit.price };
}

/** Arrow segment biased upward in price (bullish). */
function buildArrowUpSegment(chart, hit, deltaX = 72) {
  if (!chart || !hit) return null;
  const x1 = chart.timeScale().timeToCoordinate(hit.time);
  if (x1 == null) return null;
  const t2 = chart.timeScale().coordinateToTime(Math.min(x1 + deltaX, chart.timeScale().width() - 1e-6));
  if (t2 == null) return null;
  const span = Math.max(Math.abs(Number(hit.price)) * 0.003, 0.02);
  return { t1: hit.time, p1: hit.price - span * 0.2, t2, p2: hit.price + span, direction: 'up' };
}

/** Arrow segment biased downward in price (bearish). */
function buildArrowDownSegment(chart, hit, deltaX = 72) {
  if (!chart || !hit) return null;
  const x1 = chart.timeScale().timeToCoordinate(hit.time);
  if (x1 == null) return null;
  const t2 = chart.timeScale().coordinateToTime(Math.min(x1 + deltaX, chart.timeScale().width() - 1e-6));
  if (t2 == null) return null;
  const span = Math.max(Math.abs(Number(hit.price)) * 0.003, 0.02);
  return { t1: hit.time, p1: hit.price + span * 0.2, t2, p2: hit.price - span, direction: 'down' };
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Top-most drawing id under pointer (stack coordinates), or null. */
function findDrawingIdAtPointer(chart, series, stackEl, drawings, clientX, clientY, tol = 12) {
  if (!chart || !series || !stackEl || !drawings?.length) return null;
  const stackRect = stackEl.getBoundingClientRect();
  const px = clientX - stackRect.left;
  const py = clientY - stackRect.top;
  const paneCanvas = getMainPaneInteractionCanvas(chart);
  const paneRect = paneCanvas?.getBoundingClientRect();
  const offX = paneRect ? paneRect.left - stackRect.left : 0;
  const offY = paneRect ? paneRect.top - stackRect.top : 0;
  const tToX = (t) => {
    const x = chart.timeScale().timeToCoordinate(t);
    return x == null ? null : x + offX;
  };
  const pToY = (pr) => {
    const y = series.priceToCoordinate(pr);
    return y == null ? null : y + offY;
  };
  const w = stackRect.width;
  for (let i = drawings.length - 1; i >= 0; i -= 1) {
    const d = drawings[i];
    if (d.type === 'line' || d.type === 'arrow') {
      const x1 = tToX(d.t1);
      const y1 = pToY(d.p1);
      const x2 = tToX(d.t2);
      const y2 = pToY(d.p2);
      if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
      if (distToSegment(px, py, x1, y1, x2, y2) <= tol) return d.id;
    } else if (d.type === 'hline') {
      const y = pToY(d.price);
      if (y == null) continue;
      if (Math.abs(py - y) <= tol && px >= -tol && px <= w + tol) return d.id;
    } else if (d.type === 'box') {
      const x1 = tToX(d.t1);
      const y1 = pToY(d.p1);
      const x2 = tToX(d.t2);
      const y2 = pToY(d.p2);
      if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
      const left = Math.min(x1, x2) - tol * 0.5;
      const right = Math.max(x1, x2) + tol * 0.5;
      const top = Math.min(y1, y2) - tol * 0.5;
      const bot = Math.max(y1, y2) + tol * 0.5;
      if (px >= left && px <= right && py >= top && py <= bot) return d.id;
    } else if (d.type === 'marker') {
      const x = tToX(d.time);
      const y = pToY(d.price);
      if (x == null || y == null) continue;
      if (Math.hypot(px - x, py - y) <= tol + 6) return d.id;
    } else if (d.type === 'text') {
      const x = tToX(d.time);
      const y = pToY(d.price);
      if (x == null || y == null) continue;
      const tw = Math.max(24, String(d.text || '').length * 7.5);
      if (px >= x - 2 && px <= x + tw + 6 && py >= y - 22 && py <= y + 8) return d.id;
    }
  }
  return null;
}

/** Return which trend-line endpoint is closest to pointer, or null if none. */
function findLineHandleAtPointer(chart, series, stackEl, drawing, clientX, clientY, tol = 16) {
  if (!chart || !series || !stackEl || !drawing || drawing.type !== 'line') return null;
  const paneCanvas = getMainPaneInteractionCanvas(chart);
  const stackRect = stackEl.getBoundingClientRect();
  const paneRect = paneCanvas?.getBoundingClientRect();
  const offX = paneRect ? paneRect.left - stackRect.left : 0;
  const offY = paneRect ? paneRect.top - stackRect.top : 0;
  const x1 = chart.timeScale().timeToCoordinate(drawing.t1);
  const y1 = series.priceToCoordinate(drawing.p1);
  const x2 = chart.timeScale().timeToCoordinate(drawing.t2);
  const y2 = series.priceToCoordinate(drawing.p2);
  if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
  const px = clientX - stackRect.left;
  const py = clientY - stackRect.top;
  const d1 = Math.hypot(px - (x1 + offX), py - (y1 + offY));
  const d2 = Math.hypot(px - (x2 + offX), py - (y2 + offY));
  if (d1 > tol && d2 > tol) return null;
  return d1 <= d2 ? 'p1' : 'p2';
}

function arrowDirection(d) {
  if (d.type !== 'arrow') return 'up';
  if (d.direction === 'up' || d.direction === 'down') return d.direction;
  const a = Number(d.p1);
  const b = Number(d.p2);
  if (b > a) return 'up';
  if (b < a) return 'down';
  return 'up';
}

/** Infer bullish/bearish arrow from prices, or from vertical drag when price is flat. */
function inferArrowDirection(start, end, endClientY, startClientY) {
  if (!end) return 'up';
  if (Number(end.price) > Number(start.price)) return 'up';
  if (Number(end.price) < Number(start.price)) return 'down';
  return endClientY < startClientY ? 'up' : 'down';
}

function drawingListLabel(d) {
  switch (d.type) {
    case 'line':
      return 'Trend line';
    case 'arrow':
      return arrowDirection(d) === 'down' ? 'Arrow ↓' : 'Arrow ↑';
    case 'hline':
      return `H-line ${Number(d.price).toFixed(2)}`;
    case 'box':
      return 'Rectangle';
    case 'marker':
      return 'Marker';
    case 'text':
      return (d.text || '').slice(0, 26) || 'Text';
    default:
      return 'Drawing';
  }
}

function toFinite(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function calcHedgePreview(strategy, params) {
  const shares = Math.max(1, Math.round(toFinite(params.shares, 100)));
  const spot = Math.max(0.01, toFinite(params.spot, 1));
  if (strategy === 'protective_put') {
    const putStrike = Math.max(0.01, toFinite(params.putStrike, spot * 0.95));
    const putPremium = Math.max(0, toFinite(params.putPremium, 0));
    const maxLoss = shares * Math.max(0, spot + putPremium - putStrike);
    return {
      maxProfit: 'Unlimited',
      maxLoss: `$${maxLoss.toFixed(2)}`,
      breakeven: `$${(spot + putPremium).toFixed(2)}`,
      note: `Downside is floored near strike ${putStrike.toFixed(2)} (before slippage/fees).`,
    };
  }
  if (strategy === 'covered_call') {
    const callStrike = Math.max(0.01, toFinite(params.callStrike, spot * 1.05));
    const callPremium = Math.max(0, toFinite(params.callPremium, 0));
    const maxProfit = shares * Math.max(0, callStrike - spot + callPremium);
    const maxLoss = shares * Math.max(0, spot - callPremium);
    return {
      maxProfit: `$${maxProfit.toFixed(2)}`,
      maxLoss: `$${maxLoss.toFixed(2)}`,
      breakeven: `$${Math.max(0.01, spot - callPremium).toFixed(2)}`,
      note: `Upside is capped at strike ${callStrike.toFixed(2)}.`,
    };
  }
  const putStrike = Math.max(0.01, toFinite(params.putStrike, spot * 0.95));
  const putPremium = Math.max(0, toFinite(params.putPremium, 0));
  const callStrike = Math.max(putStrike, toFinite(params.callStrike, spot * 1.05));
  const callPremium = Math.max(0, toFinite(params.callPremium, 0));
  const netDebit = putPremium - callPremium;
  const maxProfit = shares * Math.max(0, callStrike - spot - netDebit);
  const maxLoss = shares * Math.max(0, spot + netDebit - putStrike);
  return {
    maxProfit: `$${maxProfit.toFixed(2)}`,
    maxLoss: `$${maxLoss.toFixed(2)}`,
    breakeven: `$${Math.max(0.01, spot + netDebit).toFixed(2)}`,
    note: `Collar range: ${putStrike.toFixed(2)} - ${callStrike.toFixed(2)}.`,
  };
}

function inferUnderlying(symbol) {
  const raw = String(symbol || '').toUpperCase().trim();
  if (!raw) return '';
  if (!isOptionSymbol(raw)) return raw;
  const m = raw.match(/^([A-Z]{1,6})\d{6}[CP]\d{8}$/);
  return m ? m[1] : raw;
}

function contractQtyFromShares(shares) {
  return Math.max(1, Math.round(Math.max(1, toFinite(shares, 100)) / 100));
}

function payoffAtExpiration(strategy, params, px) {
  const shares = Math.max(1, Math.round(toFinite(params.shares, 100)));
  const spot = Math.max(0.01, toFinite(params.spot, 1));
  const putStrike = Math.max(0.01, toFinite(params.putStrike, spot * 0.95));
  const putPremium = Math.max(0, toFinite(params.putPremium, 0));
  const callStrike = Math.max(0.01, toFinite(params.callStrike, spot * 1.05));
  const callPremium = Math.max(0, toFinite(params.callPremium, 0));
  const stockPnl = shares * (px - spot);
  if (strategy === 'protective_put') {
    const putPnl = shares * (Math.max(putStrike - px, 0) - putPremium);
    return stockPnl + putPnl;
  }
  if (strategy === 'covered_call') {
    const callPnl = shares * (callPremium - Math.max(px - callStrike, 0));
    return stockPnl + callPnl;
  }
  const putPnl = shares * (Math.max(putStrike - px, 0) - putPremium);
  const callPnl = shares * (callPremium - Math.max(px - callStrike, 0));
  return stockPnl + putPnl + callPnl;
}

function DrawingSvg({
  chart,
  series,
  stackEl,
  width,
  height,
  drawings,
  draftShape,
  overlay,
  lineHandleState,
}) {
  const uid = useId().replace(/:/g, '');
  const arrowMarkerUpId = `arrowhead-up-${uid}`;
  const arrowMarkerDownId = `arrowhead-down-${uid}`;
  if (!chart || !series || !stackEl || width < 8 || height < 8) return null;

  const paneCanvas = getMainPaneInteractionCanvas(chart);
  const stackRect = stackEl.getBoundingClientRect();
  const paneRect = paneCanvas?.getBoundingClientRect();
  const offX = paneRect ? paneRect.left - stackRect.left : 0;
  const offY = paneRect ? paneRect.top - stackRect.top : 0;

  const tToX = (t) => {
    const x = chart.timeScale().timeToCoordinate(t);
    if (x == null) return null;
    return x + offX;
  };
  const pToY = (pr) => {
    const y = series.priceToCoordinate(pr);
    if (y == null) return null;
    return y + offY;
  };

  const paths = [];

  drawings.forEach((d) => {
    if (d.type === 'line' || d.type === 'arrow') {
      const x1 = tToX(d.t1);
      const y1 = pToY(d.p1);
      const x2 = tToX(d.t2);
      const y2 = pToY(d.p2);
      if (x1 == null || y1 == null || x2 == null || y2 == null) return;
      if (d.type === 'arrow') {
        const dir = arrowDirection(d);
        const arrowStroke = dir === 'down' ? overlay.arrowDown : overlay.arrowUp;
        const markerId = dir === 'down' ? arrowMarkerDownId : arrowMarkerUpId;
        paths.push(
          <line
            key={d.id}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={arrowStroke}
            strokeWidth={2.5}
            style={{ filter: overlay.lineFilter }}
            markerEnd={`url(#${markerId})`}
            vectorEffect="non-scaling-stroke"
          />,
        );
      } else {
        paths.push(
          <line
            key={d.id}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={overlay.trend}
            strokeWidth={2.5}
            style={{ filter: overlay.lineFilter }}
            vectorEffect="non-scaling-stroke"
          />,
        );
      }
    } else if (d.type === 'marker') {
      const x = tToX(d.time);
      const y = pToY(d.price);
      if (x == null || y == null) return;
      paths.push(
        <circle
          key={d.id}
          cx={x}
          cy={y}
          r={6}
          fill={overlay.markerFill}
          stroke={overlay.markerStroke}
          strokeWidth={2}
          style={{ filter: overlay.lineFilter }}
          vectorEffect="non-scaling-stroke"
        />,
      );
    } else if (d.type === 'hline') {
      const y = pToY(d.price);
      if (y == null) return;
      paths.push(
        <line
          key={d.id}
          x1={0}
          y1={y}
          x2={width}
          y2={y}
          stroke={overlay.hline}
          strokeWidth={2}
          strokeDasharray="6 4"
          style={{ filter: overlay.lineFilter }}
          vectorEffect="non-scaling-stroke"
        />,
      );
    } else if (d.type === 'box') {
      const x1 = tToX(d.t1);
      const y1 = pToY(d.p1);
      const x2 = tToX(d.t2);
      const y2 = pToY(d.p2);
      if (x1 == null || y1 == null || x2 == null || y2 == null) return;
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      if (w < 1 && h < 1) return;
      paths.push(
        <rect
          key={d.id}
          x={left}
          y={top}
          width={w}
          height={h}
          fill={overlay.boxFill}
          stroke={overlay.boxStroke}
          strokeWidth={2}
          style={{ filter: overlay.lineFilter }}
          vectorEffect="non-scaling-stroke"
        />,
      );
    } else if (d.type === 'text') {
      const x = tToX(d.time);
      const y = pToY(d.price);
      if (x == null || y == null) return;
      paths.push(
        <text
          key={d.id}
          x={x + 4}
          y={y - 4}
          fill={overlay.textFill}
          stroke={overlay.textStroke}
          strokeWidth={overlay.textStrokeWidth}
          paintOrder="stroke fill"
          fontSize={13}
          fontWeight={600}
          style={{ userSelect: 'none' }}
        >
          {d.text}
        </text>,
      );
    }
  });

  if (lineHandleState?.drawingId) {
    const line = drawings.find((d) => d.id === lineHandleState.drawingId && d.type === 'line');
    if (line) {
      const x1 = tToX(line.t1);
      const y1 = pToY(line.p1);
      const x2 = tToX(line.t2);
      const y2 = pToY(line.p2);
      if (x1 != null && y1 != null && x2 != null && y2 != null) {
        const handleR = lineHandleState.dragging ? 5.5 : 4.5;
        paths.push(
          <g key={`_line-handles-${line.id}`} style={{ filter: overlay.lineFilter }}>
            <circle
              cx={x1}
              cy={y1}
              r={handleR}
              fill={lineHandleState.handle === 'p1' ? overlay.handleFillActive : overlay.handleFill}
              stroke={overlay.handleStroke}
              strokeWidth={1.8}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={x2}
              cy={y2}
              r={handleR}
              fill={lineHandleState.handle === 'p2' ? overlay.handleFillActive : overlay.handleFill}
              stroke={overlay.handleStroke}
              strokeWidth={1.8}
              vectorEffect="non-scaling-stroke"
            />
          </g>,
        );
      }
    }
  }

  if (draftShape?.type === 'line' || draftShape?.type === 'arrow') {
    const x1 = tToX(draftShape.t1);
    const y1 = pToY(draftShape.p1);
    const x2 = tToX(draftShape.t2);
    const y2 = pToY(draftShape.p2);
    if (x1 != null && y1 != null && x2 != null && y2 != null) {
      const draftDir =
        draftShape.type === 'arrow'
          ? draftShape.direction === 'up' || draftShape.direction === 'down'
            ? draftShape.direction
            : arrowDirection({
                type: 'arrow',
                t1: draftShape.t1,
                p1: draftShape.p1,
                t2: draftShape.t2,
                p2: draftShape.p2,
              })
          : null;
      const draftArrowStroke =
        draftShape.type === 'arrow'
          ? draftDir === 'down'
            ? overlay.arrowDown
            : overlay.arrowUp
          : overlay.trend;
      const draftMarkerId =
        draftShape.type === 'arrow'
          ? draftDir === 'down'
            ? arrowMarkerDownId
            : arrowMarkerUpId
          : null;
      paths.push(
        <line
          key="_draft-line"
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={draftArrowStroke}
          strokeWidth={2.5}
          strokeDasharray="5 4"
          opacity={0.95}
          style={{ filter: overlay.lineFilter }}
          markerEnd={draftMarkerId ? `url(#${draftMarkerId})` : undefined}
        />,
      );
    }
  }
  if (draftShape?.type === 'box') {
    const x1 = tToX(draftShape.t1);
    const y1 = pToY(draftShape.p1);
    const x2 = tToX(draftShape.t2);
    const y2 = pToY(draftShape.p2);
    if (x1 != null && y1 != null && x2 != null && y2 != null) {
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      paths.push(
        <rect
          key="_draft-box"
          x={left}
          y={top}
          width={Math.abs(x2 - x1)}
          height={Math.abs(y2 - y1)}
          fill={overlay.boxFillDraft}
          stroke={overlay.boxStroke}
          strokeWidth={2}
          strokeDasharray="5 4"
          style={{ filter: overlay.lineFilter }}
        />,
      );
    }
  }

  return (
    <svg
      width={width}
      height={height}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        zIndex: 12,
        pointerEvents: 'none',
        touchAction: 'none',
        overflow: 'visible',
      }}
    >
      <defs>
        <marker
          id={arrowMarkerUpId}
          markerWidth="10"
          markerHeight="10"
          refX="9"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L9,3 z" fill={overlay.arrowUp} />
        </marker>
        <marker
          id={arrowMarkerDownId}
          markerWidth="10"
          markerHeight="10"
          refX="9"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L9,3 z" fill={overlay.arrowDown} />
        </marker>
      </defs>
      {paths}
    </svg>
  );
}

function readThemeVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function withAlpha(color, alpha, fallback = `rgba(31, 111, 235, ${alpha})`) {
  if (!color) return fallback;
  const c = color.trim();
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1];
    const full = raw.length === 3
      ? raw.split('').map((x) => x + x).join('')
      : raw;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const rgb = c.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((v) => Number(v.trim())).slice(0, 3);
    if ([r, g, b].every(Number.isFinite)) return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return fallback;
}

function toLineData(bars) {
  return bars.map((b) => ({ time: barTimeSeconds(b), value: Number(b.close) }));
}

function toHeikinAshi(bars) {
  if (!bars.length) return [];
  const out = [];
  let prevOpen = (Number(bars[0].open) + Number(bars[0].close)) / 2;
  let prevClose = (Number(bars[0].open) + Number(bars[0].high) + Number(bars[0].low) + Number(bars[0].close)) / 4;
  out.push({
    time: barTimeSeconds(bars[0]),
    open: prevOpen,
    high: Math.max(Number(bars[0].high), prevOpen, prevClose),
    low: Math.min(Number(bars[0].low), prevOpen, prevClose),
    close: prevClose,
  });
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const haClose = (Number(b.open) + Number(b.high) + Number(b.low) + Number(b.close)) / 4;
    const haOpen = (prevOpen + prevClose) / 2;
    const haHigh = Math.max(Number(b.high), haOpen, haClose);
    const haLow = Math.min(Number(b.low), haOpen, haClose);
    out.push({ time: barTimeSeconds(b), open: haOpen, high: haHigh, low: haLow, close: haClose });
    prevOpen = haOpen;
    prevClose = haClose;
  }
  return out;
}

export default function ChartPanel({ symbol, theme }) {
  const [bars, setBars] = useState([]);
  const [timeframe, setTimeframe] = useState('1D');
  const [chartType, setChartType] = useState('candles');
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [inds, setInds] = useState(IND_INIT);
  const [panelOpen, setPanelOpen] = useState(true);
  const [chartAlerts, setChartAlerts] = useState(() => loadAllChartAlerts());
  const [alertsPanelOpen, setAlertsPanelOpen] = useState(false);
  const [alertToast, setAlertToast] = useState(null);
  const [alertDraftType, setAlertDraftType] = useState('close_cross_above');
  const [alertDraftThreshold, setAlertDraftThreshold] = useState('');
  const [alertDraftError, setAlertDraftError] = useState('');
  const [desktopAlertNotify, setDesktopAlertNotify] = useState(() => {
    try {
      return localStorage.getItem('alpaca-tv-alert-desktop') === 'true';
    } catch (_) {
      return false;
    }
  });
  const [notifyPermRev, setNotifyPermRev] = useState(0);
  const alertEvalDedupeRef = useRef(new Set());
  const [drawings, setDrawings] = useState(() => loadDrawingsForSymbol(symbol));
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;
  const [drawTool, setDrawTool] = useState(DRAW_TOOLS.pan);
  const [chartLayout, setChartLayout] = useState(CHART_LAYOUT.normal);
  const [, setOverlayRev] = useState(0);
  const [draftShape, setDraftShape] = useState(null);
  const [stackSize, setStackSize] = useState({ w: 0, h: 0 });
  const [viewportH, setViewportH] = useState(
    () => (typeof window !== 'undefined' ? window.innerHeight : 880),
  );
  const [candleBarSpacing, setCandleBarSpacing] = useState(CANDLE_BAR_SPACING_DEFAULT);
  const [contextMenu, setContextMenu] = useState(null);
  const [drawHistory, setDrawHistory] = useState([]);
  const [drawFuture, setDrawFuture] = useState([]);
  const [drawingsVisible, setDrawingsVisible] = useState(true);
  const [lineHandleState, setLineHandleState] = useState(null);
  const drawingsVisibleRef = useRef(drawingsVisible);
  drawingsVisibleRef.current = drawingsVisible;
  const [quickQty, setQuickQty] = useState('1');
  const [quickLimitPrice, setQuickLimitPrice] = useState('');
  const [tradeStatus, setTradeStatus] = useState(null);
  const [tradeSubmitting, setTradeSubmitting] = useState(false);
  const [hedgeStrategy, setHedgeStrategy] = useState('protective_put');
  const [hedgeForm, setHedgeForm] = useState({
    shares: 100,
    putStrike: '',
    putPremium: '',
    callStrike: '',
    callPremium: '',
  });
  const [hedgeContracts, setHedgeContracts] = useState({ putSymbol: '', callSymbol: '', expiration: '' });
  const [includeStockLeg, setIncludeStockLeg] = useState(false);
  const [hedgeAutoLoading, setHedgeAutoLoading] = useState(false);
  const [hedgeSubmitLoading, setHedgeSubmitLoading] = useState(false);
  const [hedgeStatus, setHedgeStatus] = useState(null);
  const [liveBarsUpdatedAt, setLiveBarsUpdatedAt] = useState(null);
  const [liveClockNow, setLiveClockNow] = useState(() => Date.now());
  const [textPrompt, setTextPrompt] = useState(null);
  const textPromptRef = useRef(null);
  textPromptRef.current = textPrompt;
  const [textDraft, setTextDraft] = useState('');
  const textDraftRef = useRef('');
  textDraftRef.current = textDraft;
  const textInputRef = useRef(null);
  const textDragSessionRef = useRef(null);
  const quoteWsRef = useRef(null);
  const palette = useMemo(() => {
    const accentStrong = readThemeVar('--accent-strong', '#1f6feb');
    const accent = readThemeVar('--accent', '#58a6ff');
    const warning = readThemeVar('--warning', '#f0883e');
    const success = readThemeVar('--success', '#3fb950');
    const danger = readThemeVar('--danger', '#f85149');
    const textSecondary = readThemeVar('--text-secondary', '#8b949e');
    return {
      accentStrong,
      accent,
      warning,
      success,
      danger,
      textSecondary,
      volume: withAlpha(accentStrong, 0.4, 'rgba(31, 111, 235, 0.4)'),
      successSoft: withAlpha(success, 0.35, 'rgba(63, 185, 80, 0.35)'),
      dangerSoft: withAlpha(danger, 0.35, 'rgba(248, 81, 73, 0.35)'),
      rsiOverbought: withAlpha(danger, 0.55, 'rgba(248, 81, 73, 0.55)'),
      rsiOversold: withAlpha(success, 0.55, 'rgba(63, 185, 80, 0.55)'),
    };
  }, [theme]);

  const alertsForSymbol = useMemo(
    () => chartAlerts.filter((a) => a.symbol === symbol),
    [chartAlerts, symbol],
  );
  const alertDraftMeta = chartAlertTypeMeta(alertDraftType);

  const addChartAlert = useCallback(() => {
    setAlertDraftError('');
    const meta = chartAlertTypeMeta(alertDraftType);
    let threshold = null;
    if (meta?.needsThreshold) {
      const raw = alertDraftThreshold.trim();
      if (meta.inputKind === 'period') {
        const n = parseInt(raw, 10);
        if (!Number.isFinite(n) || n < 3 || n > 500) {
          setAlertDraftError('Enter lookback bars between 3 and 500.');
          return;
        }
        threshold = n;
      } else {
        const n = parseFloat(raw);
        if (!Number.isFinite(n)) {
          setAlertDraftError(
            meta.inputKind === 'price' ? 'Enter a valid price level.' : 'Enter a valid RSI level.',
          );
          return;
        }
        threshold = n;
      }
    }
    setChartAlerts((p) => [
      ...p,
      {
        id: newChartAlertId(),
        symbol,
        enabled: true,
        type: alertDraftType,
        threshold,
        lastFiredBarTime: null,
      },
    ]);
  }, [alertDraftType, alertDraftThreshold, symbol]);

  const requestNotifyPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    await Notification.requestPermission();
    setNotifyPermRev((n) => n + 1);
  }, []);

  /** SVG attributes cannot rely on `var(--*)` reliably; use resolved colors for visible overlays. */
  const drawOverlay = useMemo(() => {
    const warning = readThemeVar('--warning', '#d29922');
    const accent = readThemeVar('--accent', '#58a6ff');
    const accentStrong = readThemeVar('--accent-strong', '#1f6feb');
    const isLight = theme === 'light';
    const textPrimary = readThemeVar('--text-primary', isLight ? '#1f2328' : '#e6edf3');
    const success = readThemeVar('--success', '#3fb950');
    const danger = readThemeVar('--danger', '#f85149');
    return {
      trend: warning,
      hline: accent,
      boxStroke: accentStrong,
      boxFill: withAlpha(accentStrong, isLight ? 0.22 : 0.2),
      boxFillDraft: withAlpha(accentStrong, isLight ? 0.14 : 0.12),
      markerFill: accentStrong,
      markerStroke: textPrimary,
      /** SVG text: avoid white halo on light chart (washes out fill); skip line glow on glyphs. */
      textFill: textPrimary,
      textStroke: isLight ? 'rgba(31, 35, 40, 0.22)' : 'rgba(1, 4, 9, 0.78)',
      textStrokeWidth: isLight ? 1.25 : 2,
      handleFill: isLight ? 'rgba(255, 255, 255, 0.92)' : 'rgba(13, 17, 23, 0.9)',
      handleFillActive: accentStrong,
      handleStroke: isLight ? 'rgba(9, 105, 218, 0.9)' : 'rgba(88, 166, 255, 0.95)',
      arrowUp: success,
      arrowDown: danger,
      lineFilter: isLight
        ? 'drop-shadow(0 0 2px rgba(0,0,0,0.45)) drop-shadow(0 0 1px rgba(0,0,0,0.35))'
        : 'drop-shadow(0 0 2px rgba(0,0,0,0.9)) drop-shadow(0 0 1px rgba(255,255,255,0.35))',
    };
  }, [theme]);

  const wrapRef = useRef(null);
  const mainRef = useRef(null);
  const rsiRef = useRef(null);
  const macdRef = useRef(null);
  const chartStackRef = useRef(null);
  const chartsRef = useRef({ main: null, rsi: null, macd: null });
  const chartApiRef = useRef(null);
  const mainSeriesRef = useRef(null);
  const drawToolRef = useRef(drawTool);
  drawToolRef.current = drawTool;
  const chartTypeRef = useRef(chartType);
  chartTypeRef.current = chartType;
  const spaceHeldRef = useRef(false);
  const drawToolBeforeSpaceRef = useRef(null);

  function isSpaceHotkeyBlockedTarget(target) {
    if (!target || typeof Element === 'undefined' || !(target instanceof Element)) return false;
    const el = target;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION') return true;
    if (el.isContentEditable) return true;
    const role = el.getAttribute('role');
    if (role === 'textbox' || role === 'combobox' || role === 'searchbox') return true;
    return false;
  }

  function pickDrawTool(next) {
    if (spaceHeldRef.current) drawToolBeforeSpaceRef.current = null;
    setDrawTool(next);
  }

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (e.repeat) return;
      if (isSpaceHotkeyBlockedTarget(e.target)) return;
      if (drawToolRef.current === DRAW_TOOLS.pan) return;
      e.preventDefault();
      spaceHeldRef.current = true;
      drawToolBeforeSpaceRef.current = drawToolRef.current;
      setDrawTool(DRAW_TOOLS.pan);
    };
    const onKeyUp = (e) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (!spaceHeldRef.current) return;
      spaceHeldRef.current = false;
      const saved = drawToolBeforeSpaceRef.current;
      drawToolBeforeSpaceRef.current = null;
      if (saved && drawToolRef.current === DRAW_TOOLS.pan) setDrawTool(saved);
    };
    const onBlur = () => {
      if (!spaceHeldRef.current) return;
      spaceHeldRef.current = false;
      drawToolBeforeSpaceRef.current = null;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    setDrawings(loadDrawingsForSymbol(symbol));
    setDrawHistory([]);
    setDrawFuture([]);
    setTextPrompt(null);
    setTextDraft('');
    setDraftShape(null);
    setLineHandleState(null);
    textDragSessionRef.current = null;
    setTradeStatus(null);
    setQuickLimitPrice('');
    setHedgeContracts({ putSymbol: '', callSymbol: '', expiration: '' });
    setHedgeStatus(null);
    setLiveBarsUpdatedAt(null);
  }, [symbol]);

  useEffect(() => {
    const timer = setInterval(() => setLiveClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    persistDrawings(symbol, drawings);
  }, [symbol, drawings]);

  useEffect(() => {
    persistAllChartAlerts(chartAlerts);
  }, [chartAlerts]);

  useEffect(() => {
    try {
      localStorage.setItem('alpaca-tv-alert-desktop', desktopAlertNotify ? 'true' : 'false');
    } catch (_) {}
  }, [desktopAlertNotify]);

  useEffect(() => {
    if (!alertToast) return undefined;
    const t = setTimeout(() => setAlertToast(null), 8000);
    return () => clearTimeout(t);
  }, [alertToast]);

  useEffect(() => {
    if (!symbol || bars.length < 2) return;
    const fires = evaluateAllChartAlerts(chartAlerts, bars, symbol);
    if (!fires.length) return;
    const barTime = bars[bars.length - 1].time;
    const idsToMark = new Set();
    const lines = [];
    for (const { alert, message } of fires) {
      const dk = `${alert.id}::${String(barTime)}`;
      if (alertEvalDedupeRef.current.has(dk)) continue;
      if (alert.lastFiredBarTime != null && String(alert.lastFiredBarTime) === String(barTime)) continue;
      alertEvalDedupeRef.current.add(dk);
      if (alertEvalDedupeRef.current.size > 200) alertEvalDedupeRef.current.clear();
      idsToMark.add(alert.id);
      lines.push(`${symbol}: ${message}`);
    }
    if (!idsToMark.size) return;
    setChartAlerts((prev) =>
      prev.map((a) => (idsToMark.has(a.id) ? { ...a, lastFiredBarTime: barTime } : a)),
    );
    setAlertToast({
      text: lines.length === 1 ? lines[0] : `${lines.length} alerts · ${lines.join(' · ')}`,
      at: Date.now(),
    });
    if (
      desktopAlertNotify
      && typeof Notification !== 'undefined'
      && Notification.permission === 'granted'
    ) {
      for (const { alert, message } of fires) {
        if (!idsToMark.has(alert.id)) continue;
        try {
          new Notification(`${symbol} · Alert`, {
            body: message,
            tag: `${alert.id}-${String(barTime)}`,
          });
        } catch (_) {}
      }
    }
  }, [bars, symbol, chartAlerts, desktopAlertNotify]);

  useEffect(() => {
    if (!textPrompt) return undefined;
    const t = setTimeout(() => textInputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [textPrompt]);

  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (chartLayout !== CHART_LAYOUT.expanded) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setChartLayout(CHART_LAYOUT.normal);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chartLayout]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const onDown = () => setContextMenu(null);
    const onKey = (e) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!symbol) return;
    historyExhaustedRef.current = false;
    oldestBarMsRef.current = null;
    wantPreserveVisibleRangeRef.current = false;
    pendingVisibleRangeRef.current = null;
    setLoading(true);
    Promise.all([getBars(symbol, timeframe, { limit: BAR_PAGE_LIMIT }), getSnapshot(symbol)])
      .then(([b, snap]) => {
        setBars(b);
        setSnapshot(snap);
        setLiveBarsUpdatedAt(Date.now());
        if (b.length) {
          oldestBarMsRef.current = barTimeMs(b[0]);
        } else {
          oldestBarMsRef.current = null;
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [symbol, timeframe]);

  const applyLivePriceToLastBar = useCallback((px) => {
    if (!Number.isFinite(px)) return;
    const last = barsRef.current?.length ? barsRef.current[barsRef.current.length - 1] : null;
    if (!last) return;
    const ageMs = Date.now() - barTimeMs(last);
    const windowMs = candleIntervalMs(timeframeRef.current) * 2;
    if (!Number.isFinite(ageMs) || ageMs > windowMs) return;
    const t = barTimeSeconds(last);
    const o = Number(last.open);
    const h = Math.max(Number(last.high), px);
    const l = Math.min(Number(last.low), px);
    const c = px;
    const series = mainSeriesRef.current;
    const ct = chartTypeRef.current;
    if (series) {
      try {
        if (ct === 'line' || ct === 'area') {
          series.update({ time: t, value: c });
        } else if (ct === 'bars') {
          series.update({ time: t, open: o, high: h, low: l, close: c });
        } else {
          // candles / hollow / heikin (approx intrabar heikin as raw candle update)
          series.update({ time: t, open: o, high: h, low: l, close: c });
        }
      } catch (_) {}
    }
    setLiveBarsUpdatedAt(Date.now());
  }, []);

  /** Real-time quote websocket for immediate header/chart sync. */
  useEffect(() => {
    if (!symbol) return undefined;
    quoteWsRef.current?.close?.();
    quoteWsRef.current = createQuoteSocket([symbol], (quote) => {
      if (!quote || String(quote.symbol || '').toUpperCase() !== String(symbol).toUpperCase()) return;
      const bid = Number(quote.bid_price);
      const ask = Number(quote.ask_price);
      const px = Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0
        ? (bid + ask) / 2
        : Number.isFinite(ask) && ask > 0
          ? ask
          : Number.isFinite(bid) && bid > 0
            ? bid
            : null;
      if (!Number.isFinite(px)) return;
      setSnapshot((prev) => (prev ? { ...prev, latest_trade_price: px } : { latest_trade_price: px }));
      applyLivePriceToLastBar(px);
    });
    return () => quoteWsRef.current?.close?.();
  }, [symbol, applyLivePriceToLastBar]);

  /** Poll snapshot less frequently as a fallback (greeks / daily bars). */
  useEffect(() => {
    if (!symbol) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const snap = await getSnapshot(symbol);
        if (cancelled) return;
        setSnapshot(snap);
        applyLivePriceToLastBar(Number(snap?.latest_trade_price));
      } catch (_) {}
    };
    const timer = setInterval(tick, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [symbol, applyLivePriceToLastBar]);

  const price = snapshot?.latest_trade_price;
  const prevClose = snapshot?.prev_daily_bar?.close;
  const latestBarClose = bars.length ? Number(bars[bars.length - 1].close) : null;
  const optionRef =
    snapshot?.asset_class === 'option' ? latestBarClose : null;
  const refPrice = prevClose ?? optionRef;
  const change = price != null && refPrice != null ? price - refPrice : null;
  const changePct = change != null && refPrice ? (change / refPrice) * 100 : null;
  const todayBar = snapshot?.daily_bar;
  let ivPct = null;
  if (snapshot?.implied_volatility != null) {
    const v = Number(snapshot.implied_volatility);
    ivPct = v > 0 && v <= 1 ? v * 100 : v;
  }
  const livePrice = Number.isFinite(Number(price))
    ? Number(price)
    : Number.isFinite(Number(latestBarClose))
      ? Number(latestBarClose)
      : null;
  const symbolIsOption = isOptionSymbol(symbol);
  const hedgePreview = useMemo(
    () => calcHedgePreview(hedgeStrategy, { ...hedgeForm, spot: livePrice || 1 }),
    [hedgeStrategy, hedgeForm, livePrice],
  );
  const liveAgeSec = liveBarsUpdatedAt ? Math.max(0, Math.floor((liveClockNow - liveBarsUpdatedAt) / 1000)) : null;
  const liveBadgeText = liveAgeSec == null ? 'Connecting...' : liveAgeSec < 2 ? 'Live' : `Live ${liveAgeSec}s`;
  const hedgeCurvePoints = useMemo(() => {
    const spot = Math.max(0.01, livePrice || 1);
    const minPx = spot * 0.7;
    const maxPx = spot * 1.3;
    const n = 40;
    const vals = [];
    for (let i = 0; i <= n; i += 1) {
      const px = minPx + ((maxPx - minPx) * i) / n;
      vals.push({ px, pnl: payoffAtExpiration(hedgeStrategy, { ...hedgeForm, spot }, px) });
    }
    const minPnl = Math.min(...vals.map((v) => v.pnl));
    const maxPnl = Math.max(...vals.map((v) => v.pnl));
    const width = 420;
    const height = 110;
    const p = vals.map((v, i) => {
      const x = (width * i) / n;
      const y = maxPnl === minPnl ? height / 2 : height - ((v.pnl - minPnl) / (maxPnl - minPnl)) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const zeroY = maxPnl <= 0
      ? 0
      : minPnl >= 0
        ? height
        : height - ((0 - minPnl) / (maxPnl - minPnl)) * height;
    return { width, height, path: p, minPx, maxPx, minPnl, maxPnl, zeroY };
  }, [hedgeStrategy, hedgeForm, livePrice]);

  const submitQuickOrder = useCallback(async (side, orderType) => {
    const qty = Math.max(1, Math.floor(toFinite(quickQty, 0)));
    if (!symbol || !qty) {
      setTradeStatus({ type: 'error', msg: 'Enter quantity first.' });
      return;
    }
    const limitN = toFinite(quickLimitPrice, 0);
    if (orderType === 'limit' && limitN <= 0) {
      setTradeStatus({ type: 'error', msg: 'Enter a valid limit price.' });
      return;
    }
    setTradeSubmitting(true);
    setTradeStatus(null);
    try {
      const payload = {
        symbol,
        side,
        order_type: orderType,
        qty,
        time_in_force: 'day',
        ...(orderType === 'limit' ? { limit_price: limitN } : {}),
      };
      const order = await submitOrder(payload);
      setTradeStatus({
        type: 'success',
        msg: `${side.toUpperCase()} ${orderType.toUpperCase()} submitted (${order.status || 'accepted'})`,
      });
    } catch (e) {
      setTradeStatus({ type: 'error', msg: e.message || 'Order failed' });
    } finally {
      setTradeSubmitting(false);
    }
  }, [symbol, quickQty, quickLimitPrice]);

  const autoFillHedgeFromChain = useCallback(async () => {
    const spot = Math.max(0.01, livePrice || 1);
    const underlying = inferUnderlying(symbol);
    if (!underlying) return;
    setHedgeAutoLoading(true);
    setHedgeStatus(null);
    try {
      const expRes = await getOptionExpirations(underlying, 365);
      const expirations = Array.isArray(expRes?.expirations) ? expRes.expirations : [];
      if (!expirations.length) throw new Error('No option expirations available');
      const exp = expirations[0];
      const [puts, calls] = await Promise.all([
        getOptionChain(underlying, { expirationDate: exp, contractType: 'put', limit: 200 }),
        getOptionChain(underlying, { expirationDate: exp, contractType: 'call', limit: 200 }),
      ]);
      const pickNear = (rows, target) => {
        if (!Array.isArray(rows) || !rows.length) return null;
        return rows.reduce((best, row) => {
          const d = Math.abs(toFinite(row.strike, 0) - target);
          return !best || d < best.d ? { row, d } : best;
        }, null)?.row || null;
      };
      const putTarget = hedgeStrategy === 'covered_call' ? spot * 0.95 : spot * 0.95;
      const callTarget = hedgeStrategy === 'protective_put' ? spot * 1.05 : spot * 1.05;
      const putPick = pickNear(puts, putTarget);
      const callPick = pickNear(calls, callTarget);
      const mid = (row) => {
        const bid = toFinite(row?.bid, NaN);
        const ask = toFinite(row?.ask, NaN);
        if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) return (bid + ask) / 2;
        const last = toFinite(row?.last, NaN);
        return Number.isFinite(last) ? last : 0;
      };
      setHedgeForm((prev) => ({
        ...prev,
        putStrike: putPick ? toFinite(putPick.strike, spot * 0.95).toFixed(2) : prev.putStrike,
        putPremium: putPick ? mid(putPick).toFixed(2) : prev.putPremium,
        callStrike: callPick ? toFinite(callPick.strike, spot * 1.05).toFixed(2) : prev.callStrike,
        callPremium: callPick ? mid(callPick).toFixed(2) : prev.callPremium,
      }));
      setHedgeContracts({
        putSymbol: putPick?.symbol || '',
        callSymbol: callPick?.symbol || '',
        expiration: exp,
      });
      setHedgeStatus({ type: 'success', msg: `Auto-filled from ${underlying} ${exp} chain.` });
    } catch (e) {
      setHedgeStatus({ type: 'error', msg: e.message || 'Auto-fill failed' });
    } finally {
      setHedgeAutoLoading(false);
    }
  }, [symbol, livePrice, hedgeStrategy]);

  const submitHedgeOrders = useCallback(async () => {
    const sharesQty = Math.max(1, Math.round(toFinite(hedgeForm.shares, 100)));
    const qtyContracts = contractQtyFromShares(hedgeForm.shares);
    const orders = [];
    if (includeStockLeg) {
      const stockSide = (hedgeStrategy === 'covered_call' || hedgeStrategy === 'protective_put' || hedgeStrategy === 'collar')
        ? 'buy'
        : 'buy';
      orders.push({
        symbol: inferUnderlying(symbol),
        side: stockSide,
        order_type: 'market',
        qty: sharesQty,
        time_in_force: 'day',
      });
    }
    if (hedgeStrategy === 'protective_put' || hedgeStrategy === 'collar') {
      if (!hedgeContracts.putSymbol) {
        setHedgeStatus({ type: 'error', msg: 'Auto-fill put leg first.' });
        return;
      }
      orders.push({
        symbol: hedgeContracts.putSymbol,
        side: 'buy',
        order_type: 'limit',
        qty: qtyContracts,
        time_in_force: 'day',
        limit_price: Math.max(0.01, toFinite(hedgeForm.putPremium, 0)),
      });
    }
    if (hedgeStrategy === 'covered_call' || hedgeStrategy === 'collar') {
      if (!hedgeContracts.callSymbol) {
        setHedgeStatus({ type: 'error', msg: 'Auto-fill call leg first.' });
        return;
      }
      orders.push({
        symbol: hedgeContracts.callSymbol,
        side: 'sell',
        order_type: 'limit',
        qty: qtyContracts,
        time_in_force: 'day',
        limit_price: Math.max(0.01, toFinite(hedgeForm.callPremium, 0)),
      });
    }
    if (!orders.length) {
      setHedgeStatus({ type: 'error', msg: 'No hedge legs to submit.' });
      return;
    }
    setHedgeSubmitLoading(true);
    setHedgeStatus(null);
    try {
      const out = [];
      for (const o of orders) {
        // Backend supports single-order submit; send legs sequentially.
        // eslint-disable-next-line no-await-in-loop
        const placed = await submitOrder(o);
        out.push(`${o.side.toUpperCase()} ${o.symbol} (${placed.status || 'accepted'})`);
      }
      setHedgeStatus({ type: 'success', msg: `Hedge submitted: ${out.join(' · ')}` });
    } catch (e) {
      setHedgeStatus({ type: 'error', msg: e.message || 'Hedge submit failed' });
    } finally {
      setHedgeSubmitLoading(false);
    }
  }, [hedgeStrategy, hedgeContracts, hedgeForm, includeStockLeg, symbol]);

  useEffect(() => {
    if (livePrice == null) return;
    setHedgeForm((prev) => ({
      ...prev,
      putStrike: prev.putStrike || (livePrice * 0.95).toFixed(2),
      callStrike: prev.callStrike || (livePrice * 1.05).toFixed(2),
    }));
  }, [livePrice]);

  const setInd = (key, val) => setInds((p) => ({ ...p, [key]: val }));

  const mainChartHeight = useMemo(() => {
    if (chartLayout === CHART_LAYOUT.expanded) {
      const subPanes = (inds.rsi ? 124 : 0) + (inds.macd ? 124 : 0);
      const chrome =
        56
        + (panelOpen ? 140 : 48)
        + 42
        + (todayBar ? 48 : 0)
        + 52
        + 24
        + subPanes
        + 72;
      return Math.max(420, Math.min(viewportH - chrome, 1600));
    }
    return inds.rsi || inds.macd ? 320 : 400;
  }, [
    chartLayout,
    viewportH,
    inds.rsi,
    inds.macd,
    panelOpen,
    todayBar,
  ]);

  const openFullScreenChart = useCallback(() => {
    setChartLayout(CHART_LAYOUT.expanded);
  }, []);

  const commitDrawings = useCallback((updater) => {
    setDrawings((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      setDrawHistory((h) => [...h, prev]);
      setDrawFuture([]);
      return next;
    });
    deferAfterLayout(() => setOverlayRev((v) => v + 1));
  }, []);

  const undoDrawings = useCallback(() => {
    setDrawHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setDrawings((curr) => {
        setDrawFuture((f) => [curr, ...f]);
        return prev;
      });
      return h.slice(0, -1);
    });
    deferAfterLayout(() => setOverlayRev((v) => v + 1));
  }, []);

  const redoDrawings = useCallback(() => {
    setDrawFuture((f) => {
      if (!f.length) return f;
      const [next, ...rest] = f;
      setDrawings((curr) => {
        setDrawHistory((h) => [...h, curr]);
        return next;
      });
      return rest;
    });
    deferAfterLayout(() => setOverlayRev((v) => v + 1));
  }, []);

  const submitTextPrompt = useCallback(() => {
    const tp = textPromptRef.current;
    if (!tp) return;
    const t = textDraftRef.current.trim();
    if (tp.drawingId) {
      if (!t) {
        commitDrawings((prev) => prev.filter((d) => d.id !== tp.drawingId));
      } else {
        commitDrawings((prev) =>
          prev.map((d) => (d.id === tp.drawingId ? { ...d, text: t } : d)),
        );
      }
    } else if (t) {
      commitDrawings((prev) => [
        ...prev,
        {
          id: newDrawingId(),
          type: 'text',
          time: tp.time,
          price: tp.price,
          text: t,
        },
      ]);
    }
    setTextPrompt(null);
    setTextDraft('');
  }, [commitDrawings]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (isSpaceHotkeyBlockedTarget(e.target)) return;
      if (textPromptRef.current) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redoDrawings();
        else undoDrawings();
        return;
      }
      if (e.ctrlKey && !e.metaKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redoDrawings();
        return;
      }
      if (e.key === 'Delete') {
        if (!drawingsRef.current.length) return;
        e.preventDefault();
        commitDrawings((p) => p.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undoDrawings, redoDrawings, commitDrawings]);

  const resetChartView = useCallback(() => {
    const { main, rsi, macd } = chartsRef.current;
    const bs = Math.max(candleBarSpacing, CANDLE_BAR_SPACING_MIN);
    deferAfterLayout(() => {
      try {
        if (main) {
          main.timeScale().fitContent();
          main.timeScale().applyOptions({ barSpacing: bs });
          main.priceScale('right').applyOptions({ autoScale: true });
        }
        if (rsi) {
          rsi.timeScale().fitContent();
          rsi.timeScale().applyOptions({ barSpacing: bs });
        }
        if (macd) {
          macd.timeScale().fitContent();
          macd.timeScale().applyOptions({ barSpacing: bs });
        }
      } catch (_) {}
    });
  }, [candleBarSpacing]);

  const zoomCandles = useCallback((delta) => {
    setCandleBarSpacing((prev) => {
      const next = Math.max(
        CANDLE_BAR_SPACING_MIN,
        Math.min(CANDLE_BAR_SPACING_MAX, prev + delta),
      );
      deferAfterLayout(() => {
        const { main, rsi, macd } = chartsRef.current;
        try {
          if (main) main.timeScale().applyOptions({ barSpacing: next });
          if (rsi) rsi.timeScale().applyOptions({ barSpacing: next });
          if (macd) macd.timeScale().applyOptions({ barSpacing: next });
        } catch (_) {}
      });
      return next;
    });
  }, []);

  const onChartContextMenu = useCallback((e) => {
    e.preventDefault();
    const chart = chartApiRef.current;
    const series = mainSeriesRef.current;
    const stack = chartStackRef.current;
    if (!chart || !series) return;
    const hit = logicalFromPixel(chart, series, e.clientX, e.clientY);
    const drawingId =
      stack && drawingsRef.current?.length
        ? findDrawingIdAtPointer(chart, series, stack, drawingsRef.current, e.clientX, e.clientY)
        : null;
    setContextMenu({ x: e.clientX, y: e.clientY, hit, drawingId });
  }, []);

  const bumpOverlay = useCallback(() => {
    setOverlayRev((v) => v + 1);
  }, []);

  useLayoutEffect(() => {
    const stack = chartStackRef.current;
    if (!stack) return undefined;
    const ro = new ResizeObserver(() => {
      deferAfterLayout(() => {
        if (!stack.isConnected) return;
        setStackSize({ w: stack.clientWidth, h: stack.clientHeight });
      });
    });
    ro.observe(stack);
    setStackSize({ w: stack.clientWidth, h: stack.clientHeight });
    return () => ro.disconnect();
  }, [mainChartHeight, chartLayout, symbol, loading, bars.length]);

  const barsRef = useRef(bars);
  barsRef.current = bars;
  const timeframeRef = useRef(timeframe);
  timeframeRef.current = timeframe;
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;

  const oldestBarMsRef = useRef(null);
  const historyLoadingRef = useRef(false);
  const historyExhaustedRef = useRef(false);
  /** When true, next chart rebuild should restore the prior visible time range (e.g. prepending history). */
  const wantPreserveVisibleRangeRef = useRef(false);
  const pendingVisibleRangeRef = useRef(null);

  /** Keep active timeframe bars live by polling and merging newest bars. */
  useEffect(() => {
    if (!symbol) return undefined;
    let cancelled = false;
    const poll = async () => {
      if (historyLoadingRef.current) return;
      try {
        const incoming = await getBars(symbolRef.current, timeframeRef.current, { limit: LIVE_POLL_LIMIT });
        if (cancelled || !Array.isArray(incoming) || !incoming.length) return;
        setBars((prev) => {
          const merged = mergeBarsUnique(prev, incoming);
          if (barsEqual(prev, merged)) return prev;
          setLiveBarsUpdatedAt(Date.now());
          if (merged.length) oldestBarMsRef.current = barTimeMs(merged[0]);
          return merged;
        });
      } catch (_) {}
    };
    const intervalMs = livePollMsForTimeframe(timeframe);
    const timer = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [symbol, timeframe]);

  useLayoutEffect(() => {
    const { main: prevMain, rsi: prevRsi, macd: prevMacd } = chartsRef.current;
    if (prevMain) {
      try {
        if (wantPreserveVisibleRangeRef.current) {
          const tr = prevMain.timeScale().getVisibleRange();
          pendingVisibleRangeRef.current = tr && tr.from != null && tr.to != null ? tr : null;
        } else {
          pendingVisibleRangeRef.current = null;
        }
      } catch (_) {
        pendingVisibleRangeRef.current = null;
      }
      try {
        prevMain.remove();
      } catch (_) {}
    }
    if (prevRsi) {
      try {
        prevRsi.remove();
      } catch (_) {}
    }
    if (prevMacd) {
      try {
        prevMacd.remove();
      } catch (_) {}
    }
    chartsRef.current = { main: null, rsi: null, macd: null };
    chartApiRef.current = null;
    mainSeriesRef.current = null;

    if (
      chartLayout === CHART_LAYOUT.minimized
      || !symbol
      || !mainRef.current
      || loading
    ) {
      return undefined;
    }

    const candleData = buildCandles(bars);
    if (!candleData.length) return undefined;

    const w = chartStackRef.current?.clientWidth ?? mainRef.current.clientWidth ?? 800;
    const chartOptions = {
      layout: {
        background: { type: ColorType.Solid, color: readThemeVar('--bg-canvas', '#0b0f15') },
        textColor: readThemeVar('--text-secondary', '#8b949e'),
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: readThemeVar('--grid-line', '#21262d') },
        horzLines: { color: readThemeVar('--grid-line', '#21262d') },
      },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: { borderColor: readThemeVar('--border', '#30363d') },
      timeScale: {
        borderColor: readThemeVar('--border', '#30363d'),
        timeVisible: true,
        secondsVisible: false,
        barSpacing: candleBarSpacing,
        tickMarkFormatter: (time) => formatEtLabel(time),
      },
      localization: {
        timeFormatter: (time) => formatEtLabel(time),
      },
      width: w,
      height: mainChartHeight,
    };

    const chart = createChart(mainRef.current, chartOptions);
    chartsRef.current.main = chart;
    chartApiRef.current = chart;

    let mainSeries;
    if (chartType === 'line') {
      mainSeries = chart.addLineSeries({ color: palette.accent, lineWidth: 2, priceLineVisible: false });
      mainSeries.setData(toLineData(bars));
    } else if (chartType === 'area') {
      mainSeries = chart.addAreaSeries({
        lineColor: palette.accent,
        topColor: withAlpha(palette.accent, 0.32),
        bottomColor: withAlpha(palette.accent, 0.05),
        lineWidth: 2,
        priceLineVisible: false,
      });
      mainSeries.setData(toLineData(bars));
    } else if (chartType === 'bars') {
      mainSeries = chart.addBarSeries({
        upColor: palette.success,
        downColor: palette.danger,
        thinBars: false,
      });
      mainSeries.setData(candleData);
    } else {
      const useHeikin = chartType === 'heikin';
      const ohlc = useHeikin ? toHeikinAshi(bars) : candleData;
      const hollow = chartType === 'hollow';
      const solidCandleOpts = {
        upColor: palette.success,
        downColor: palette.danger,
        borderVisible: false,
        wickUpColor: palette.success,
        wickDownColor: palette.danger,
      };
      const hollowCandleOpts = {
        upColor: 'rgba(0, 0, 0, 0)',
        downColor: palette.danger,
        borderVisible: true,
        borderColor: palette.success,
        borderUpColor: palette.success,
        borderDownColor: palette.danger,
        wickUpColor: palette.success,
        wickDownColor: palette.danger,
      };
      mainSeries = chart.addCandlestickSeries(hollow ? hollowCandleOpts : solidCandleOpts);
      mainSeries.setData(ohlc);
    }
    mainSeriesRef.current = mainSeries;
    if (inds.tradeSignals && bars.length > 35) {
      mainSeries.setMarkers(
        chartMacdHistogramSignalMarkers(bars, {
          minBarGap: 5,
          buyColor: palette.success,
          sellColor: palette.danger,
        }),
      );
    } else {
      mainSeries.setMarkers([]);
    }

    const onLogicalRangeChange = (logicalRange) => {
      deferAfterLayout(() => bumpOverlay());
      if (!logicalRange || historyLoadingRef.current || historyExhaustedRef.current) return;
      const b = barsRef.current;
      if (!b.length) return;
      const oldest = oldestBarMsRef.current;
      if (oldest == null) return;
      if (logicalRange.from == null) return;
      // When the user pans toward the left edge, request another page of older bars.
      if (logicalRange.from > 12) return;

      const tf = timeframeRef.current;
      const span = HISTORY_PAGE_MS[tf] ?? 90 * 24 * 60 * 60 * 1000;
      const endMs = oldest - 1;
      const startMs = endMs - span;
      if (endMs <= startMs) return;

      historyLoadingRef.current = true;
      getBars(symbolRef.current, tf, {
        limit: BAR_PAGE_LIMIT,
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
      })
        .then((chunk) => {
          if (!chunk.length) {
            historyExhaustedRef.current = true;
            return;
          }
          const beforeOldest = oldestBarMsRef.current;
          wantPreserveVisibleRangeRef.current = true;
          setBars((prev) => {
            const merged = mergeBarsUnique(prev, chunk);
            const nextOldest = merged.length ? barTimeMs(merged[0]) : null;
            oldestBarMsRef.current = nextOldest;
            if (beforeOldest != null && nextOldest != null && nextOldest >= beforeOldest) {
              historyExhaustedRef.current = true;
            }
            return merged;
          });
        })
        .catch(console.error)
        .finally(() => {
          historyLoadingRef.current = false;
        });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onLogicalRangeChange);
    deferAfterLayout(() => bumpOverlay());

    if (inds.volume) {
      const vol = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        scaleMargins: { top: 0.85, bottom: 0 },
        color: palette.volume,
      });
      vol.setData(
        bars.map((b) => {
          const t = barTimeSeconds(b);
          const o = Number(b.open);
          const c = Number(b.close);
          return {
            time: t,
            value: Number(b.volume) || 0,
            color: c >= o ? palette.successSoft : palette.dangerSoft,
          };
        }),
      );
    }

    const lineStyle = (c, wLine = 1) => ({
      color: c,
      lineWidth: wLine,
      priceLineVisible: false,
      lastValueVisible: true,
    });

    if (inds.sma9 && bars.length >= 9) {
      const se = chart.addLineSeries(lineStyle(palette.accent, 1));
      se.setData(seriesSMA(bars, 9));
    }
    if (inds.sma20 && bars.length >= 20) {
      const se = chart.addLineSeries(lineStyle(palette.accent, 1));
      se.setData(seriesSMA(bars, 20));
    }
    if (inds.wma20 && bars.length >= 20) {
      const se = chart.addLineSeries(lineStyle(withAlpha(palette.accent, 0.9), 1));
      se.setData(seriesWMA(bars, 20));
    }
    if (inds.sma50 && bars.length >= 50) {
      const se = chart.addLineSeries(lineStyle(palette.warning, 1));
      se.setData(seriesSMA(bars, 50));
    }
    if (inds.sma100 && bars.length >= 100) {
      const se = chart.addLineSeries(lineStyle(withAlpha(palette.warning, 0.9), 1));
      se.setData(seriesSMA(bars, 100));
    }
    if (inds.sma200 && bars.length >= 200) {
      const se = chart.addLineSeries(lineStyle(palette.success, 1));
      se.setData(seriesSMA(bars, 200));
    }
    if (inds.ema12 && bars.length >= 12) {
      const se = chart.addLineSeries(lineStyle(palette.accent, 1));
      se.setData(seriesEMA(bars, 12));
    }
    if (inds.ema26 && bars.length >= 26) {
      const se = chart.addLineSeries(lineStyle(palette.warning, 1));
      se.setData(seriesEMA(bars, 26));
    }
    if (inds.ema50 && bars.length >= 50) {
      const se = chart.addLineSeries(lineStyle(withAlpha(palette.accent, 0.75), 1));
      se.setData(seriesEMA(bars, 50));
    }
    if (inds.ema200 && bars.length >= 200) {
      const se = chart.addLineSeries(lineStyle(withAlpha(palette.success, 0.85), 1));
      se.setData(seriesEMA(bars, 200));
    }
    if (inds.bb && bars.length >= 20) {
      const { upper, lower, middle } = seriesBollinger(bars, 20, 2);
      chart.addLineSeries({ ...lineStyle(palette.textSecondary, 1), lineStyle: 2 }).setData(upper);
      chart.addLineSeries({ ...lineStyle(palette.textSecondary, 1), lineStyle: 2 }).setData(lower);
      chart.addLineSeries(lineStyle(palette.accent, 1)).setData(middle);
    }
    if (inds.donchian && bars.length >= 20) {
      const { upper, lower, middle } = seriesDonchian(bars, 20);
      chart.addLineSeries({ ...lineStyle(withAlpha(palette.accent, 0.65), 1), lineStyle: 2 }).setData(upper);
      chart.addLineSeries({ ...lineStyle(withAlpha(palette.accent, 0.65), 1), lineStyle: 2 }).setData(lower);
      chart.addLineSeries(lineStyle(withAlpha(palette.textSecondary, 0.8), 1)).setData(middle);
    }
    if (inds.vwap && bars.length) {
      const v = seriesVWAP(bars);
      if (v.length) chart.addLineSeries(lineStyle(palette.warning, 2)).setData(v);
    }
    if (inds.atr14 && bars.length > 14) {
      const atr = seriesATR(bars, 14);
      chart.addLineSeries(lineStyle(withAlpha(palette.warning, 0.8), 1)).setData(atr);
    }

    if (refPrice != null && Number.isFinite(refPrice)) {
      mainSeries.createPriceLine({
        price: refPrice,
        title: prevClose != null ? 'Prev close' : 'Ref',
        color: palette.textSecondary,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
      });
    }

    const rsiCharts = [];
    if (inds.rsi && rsiRef.current && bars.length > 15) {
      const rsiChart = createChart(rsiRef.current, {
        ...chartOptions,
        height: 110,
        timeScale: { ...chartOptions.timeScale, visible: !inds.macd },
      });
      chartsRef.current.rsi = rsiChart;
      rsiCharts.push(rsiChart);
      const rsi = rsiChart.addLineSeries({ color: palette.accent, lineWidth: 1, priceLineVisible: false });
      rsi.setData(seriesRSI(bars, 14));
      rsi.createPriceLine({ price: 70, color: palette.rsiOverbought, lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      rsi.createPriceLine({ price: 30, color: palette.rsiOversold, lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      rsiChart.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
    }

    const macdCharts = [];
    if (inds.macd && macdRef.current && bars.length > 35) {
      const mChart = createChart(macdRef.current, {
        ...chartOptions,
        height: 110,
        timeScale: { ...chartOptions.timeScale, visible: !inds.rsi },
      });
      chartsRef.current.macd = mChart;
      macdCharts.push(mChart);
      const { macd, signal, histogram } = seriesMACD(bars, 12, 26, 9);
      mChart.addHistogramSeries({
        priceScaleId: '',
        scaleMargins: { top: 0.2, bottom: 0 },
        priceLineVisible: false,
      }).setData(histogram);
      mChart.addLineSeries({ ...lineStyle(palette.accent, 1), priceLineVisible: false }).setData(macd);
      mChart.addLineSeries({ ...lineStyle(palette.warning, 1), priceLineVisible: false }).setData(signal);
    }

    const others = [...rsiCharts, ...macdCharts];
    if (others.length) syncCharts(chart, others);

    const saved = pendingVisibleRangeRef.current;
    pendingVisibleRangeRef.current = null;
    const bs = Math.max(candleBarSpacing, CANDLE_BAR_SPACING_MIN);
    deferAfterLayout(() => {
      try {
        if (saved && saved.from != null && saved.to != null) {
          chart.timeScale().setVisibleRange(saved);
          chart.timeScale().applyOptions({ barSpacing: bs });
          if (others.length) {
            others.forEach((c) => {
              try {
                c.timeScale().setVisibleRange(saved);
                c.timeScale().applyOptions({ barSpacing: bs });
              } catch (_) {}
            });
          }
        } else {
          chart.timeScale().fitContent();
          chart.timeScale().applyOptions({ barSpacing: bs });
          if (others.length) {
            others.forEach((c) => {
              try {
                c.timeScale().fitContent();
                c.timeScale().applyOptions({ barSpacing: bs });
              } catch (_) {}
            });
          }
        }
      } catch (_) {
        try {
          chart.timeScale().fitContent();
          chart.timeScale().applyOptions({ barSpacing: bs });
        } catch (__) {}
      } finally {
        wantPreserveVisibleRangeRef.current = false;
      }
    });

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onLogicalRangeChange);
      try {
        chart.remove();
      } catch (_) {}
      rsiCharts.forEach((c) => {
        try {
          c.remove();
        } catch (_) {}
      });
      macdCharts.forEach((c) => {
        try {
          c.remove();
        } catch (_) {}
      });
      chartsRef.current = { main: null, rsi: null, macd: null };
      chartApiRef.current = null;
      mainSeriesRef.current = null;
    };
  }, [
    symbol,
    bars,
    timeframe,
    chartType,
    loading,
    inds,
    refPrice,
    prevClose,
    snapshot?.asset_class,
    chartLayout,
    mainChartHeight,
    candleBarSpacing,
    bumpOverlay,
    theme,
    palette,
  ]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      deferAfterLayout(() => {
        if (!el.isConnected) return;
        const width = el.clientWidth;
        const { main, rsi, macd } = chartsRef.current;
        if (main) main.applyOptions({ width });
        if (rsi) rsi.applyOptions({ width });
        if (macd) macd.applyOptions({ width });
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const releasePointerIfAny = (canvas, pointerId) => {
    try {
      if (canvas?.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
    } catch (_) {}
  };

  const onDrawingCanvasPointerDown = useCallback((e) => {
    if (drawToolRef.current === DRAW_TOOLS.pan) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const tool = drawToolRef.current;
    const chart = chartApiRef.current;
    const series = mainSeriesRef.current;
    const canvas = getMainPaneInteractionCanvas(chart);
    if (!chart || !series || !canvas) return;
    const hit = logicalFromPixel(chart, series, e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    e.stopImmediatePropagation?.();
    e.stopPropagation();

    if (tool === DRAW_TOOLS.hline) {
      commitDrawings((prev) => [...prev, { id: newDrawingId(), type: 'hline', price: hit.price }]);
      return;
    }
    if (tool === DRAW_TOOLS.text) {
      setTextDraft('');
      setTextPrompt({ x: e.clientX, y: e.clientY, time: hit.time, price: hit.price });
      return;
    }
    if (tool === DRAW_TOOLS.marker) {
      commitDrawings((prev) => [...prev, { id: newDrawingId(), type: 'marker', time: hit.time, price: hit.price }]);
      return;
    }

    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (_) {}

    const start = { time: hit.time, price: hit.price };
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const pid = e.pointerId;
    const isArrow = tool === DRAW_TOOLS.arrow;
    const draftType = isArrow ? 'arrow' : 'line';

    if (tool === DRAW_TOOLS.line || tool === DRAW_TOOLS.arrow) {
      const move = (ev) => {
        if (ev.pointerId !== pid) return;
        const end = logicalFromPixel(chartApiRef.current, mainSeriesRef.current, ev.clientX, ev.clientY);
        if (!end) return;
        const direction = isArrow ? inferArrowDirection(start, end, ev.clientY, startClientY) : undefined;
        setDraftShape({
          type: draftType,
          t1: start.time,
          p1: start.price,
          t2: end.time,
          p2: end.price,
          ...(direction ? { direction } : {}),
        });
      };
      const up = (ev) => {
        if (ev.pointerId !== pid) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        releasePointerIfAny(canvas, pid);
        const end = logicalFromPixel(chartApiRef.current, mainSeriesRef.current, ev.clientX, ev.clientY);
        setDraftShape(null);
        const moved = drawingMovedEnough(startClientX, startClientY, ev.clientX, ev.clientY);
        const priceDiff = end && Math.abs(end.price - start.price) > 1e-12;
        const timeDiff = end && timeKey(end.time) !== timeKey(start.time);
        if (end && (moved || priceDiff || timeDiff)) {
          const direction = isArrow ? inferArrowDirection(start, end, ev.clientY, startClientY) : undefined;
          commitDrawings((prev) => [
            ...prev,
            {
              id: newDrawingId(),
              type: isArrow ? 'arrow' : 'line',
              t1: start.time,
              p1: start.price,
              t2: end.time,
              p2: end.price,
              ...(direction ? { direction } : {}),
            },
          ]);
        }
      };
      window.addEventListener('pointermove', move, { passive: true });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      return;
    }

    if (tool === DRAW_TOOLS.box) {
      const move = (ev) => {
        if (ev.pointerId !== pid) return;
        const end = logicalFromPixel(chartApiRef.current, mainSeriesRef.current, ev.clientX, ev.clientY);
        if (end) setDraftShape({ type: 'box', t1: start.time, p1: start.price, t2: end.time, p2: end.price });
      };
      const up = (ev) => {
        if (ev.pointerId !== pid) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        releasePointerIfAny(canvas, pid);
        const end = logicalFromPixel(chartApiRef.current, mainSeriesRef.current, ev.clientX, ev.clientY);
        setDraftShape(null);
        const moved = drawingMovedEnough(startClientX, startClientY, ev.clientX, ev.clientY);
        const priceDiff = end && Math.abs(end.price - start.price) > 1e-12;
        const timeDiff = end && timeKey(end.time) !== timeKey(start.time);
        if (end && (moved || priceDiff || timeDiff)) {
          commitDrawings((prev) => [
            ...prev,
            {
              id: newDrawingId(),
              type: 'box',
              t1: start.time,
              p1: start.price,
              t2: end.time,
              p2: end.price,
            },
          ]);
        }
      };
      window.addEventListener('pointermove', move, { passive: true });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      return;
    }

    releasePointerIfAny(canvas, e.pointerId);
  }, [commitDrawings]);

  const drawingListenerCleanupRef = useRef(() => {});

  useEffect(() => {
    drawingListenerCleanupRef.current();
    drawingListenerCleanupRef.current = () => {};

    if (drawToolRef.current === DRAW_TOOLS.pan) return undefined;

    let cancelled = false;
    let raf = 0;
    let tries = 0;
    const attach = () => {
      if (cancelled) return;
      const chart = chartApiRef.current;
      const root = chart?.chartElement?.();
      if (!root) {
        tries += 1;
        if (tries < 220) raf = requestAnimationFrame(attach);
        return;
      }
      const handler = (ev) => {
        if (!root.contains(ev.target)) return;
        onDrawingCanvasPointerDown(ev);
      };
      root.addEventListener('pointerdown', handler, true);
      drawingListenerCleanupRef.current = () => {
        root.removeEventListener('pointerdown', handler, true);
      };
    };

    attach();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      drawingListenerCleanupRef.current();
      drawingListenerCleanupRef.current = () => {};
    };
  }, [
    onDrawingCanvasPointerDown,
    drawTool,
    symbol,
    loading,
    bars.length,
    timeframe,
    chartType,
    inds,
    chartLayout,
    mainChartHeight,
    candleBarSpacing,
    theme,
    palette,
  ]);

  /** Pan mode: drag text labels; double-click to edit. */
  useEffect(() => {
    if (drawTool !== DRAW_TOOLS.pan || !drawingsVisible) return undefined;

    let cancelled = false;
    let raf = 0;
    let tries = 0;
    let detach = () => {};

    const attach = () => {
      if (cancelled) return;
      const chart = chartApiRef.current;
      const root = chart?.chartElement?.();
      if (!root) {
        tries += 1;
        if (tries < 220) raf = requestAnimationFrame(attach);
        return;
      }

      const onPointerDown = (e) => {
        if (textDragSessionRef.current) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (!root.contains(e.target)) return;
        if (drawToolRef.current !== DRAW_TOOLS.pan || !drawingsVisibleRef.current) return;
        const chart2 = chartApiRef.current;
        const series = mainSeriesRef.current;
        const stack = chartStackRef.current;
        if (!chart2 || !series || !stack) return;
        const id = findDrawingIdAtPointer(
          chart2,
          series,
          stack,
          drawingsRef.current,
          e.clientX,
          e.clientY,
        );
        if (!id) return;
        const d = drawingsRef.current.find((x) => x.id === id);
        if (!d || (d.type !== 'text' && d.type !== 'line')) return;
        const canvas = getMainPaneInteractionCanvas(chart2);
        if (!canvas) return;
        const lineHandle = d.type === 'line'
          ? findLineHandleAtPointer(chart2, series, stack, d, e.clientX, e.clientY)
          : null;
        if (d.type === 'line' && !lineHandle) return;
        if (d.type === 'line') setLineHandleState({ drawingId: d.id, handle: lineHandle, dragging: true });
        e.preventDefault();
        e.stopPropagation();
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch (_) {}

        const snapshot = drawingsRef.current.map((x) => ({ ...x }));
        const pid = e.pointerId;
        const startX = e.clientX;
        const startY = e.clientY;
        textDragSessionRef.current = {
          id: d.id,
          type: d.type,
          lineHandle,
          snapshot,
          pointerId: pid,
          startX,
          startY,
          dragged: false,
        };

        const move = (ev) => {
          const s = textDragSessionRef.current;
          if (!s || ev.pointerId !== pid) return;
          if (drawingMovedEnough(s.startX, s.startY, ev.clientX, ev.clientY)) s.dragged = true;
          const ch = chartApiRef.current;
          const ser = mainSeriesRef.current;
          if (!ch || !ser) return;
          const hit = logicalFromPixel(ch, ser, ev.clientX, ev.clientY);
          if (!hit) return;
          setDrawings((prev) => prev.map((row) => {
            if (row.id !== s.id) return row;
            if (s.type === 'line') {
              if (s.lineHandle === 'p1') return { ...row, t1: hit.time, p1: hit.price };
              if (s.lineHandle === 'p2') return { ...row, t2: hit.time, p2: hit.price };
              return row;
            }
            return { ...row, time: hit.time, price: hit.price };
          }));
        };
        const up = (ev) => {
          if (ev.pointerId !== pid) return;
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
          releasePointerIfAny(canvas, pid);
          const session = textDragSessionRef.current;
          textDragSessionRef.current = null;
          if (session?.dragged && session.snapshot) {
            setDrawHistory((h) => [...h, session.snapshot]);
            setDrawFuture([]);
          }
          if (session?.type === 'line') setLineHandleState(null);
          deferAfterLayout(() => setOverlayRev((v) => v + 1));
        };
        window.addEventListener('pointermove', move, { passive: true });
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      };

      const onPointerMove = (e) => {
        if (!root.contains(e.target)) return;
        if (textDragSessionRef.current) return;
        if (drawToolRef.current !== DRAW_TOOLS.pan || !drawingsVisibleRef.current) return;
        const chart2 = chartApiRef.current;
        const series = mainSeriesRef.current;
        const stack = chartStackRef.current;
        if (!chart2 || !series || !stack) return;
        const id = findDrawingIdAtPointer(
          chart2,
          series,
          stack,
          drawingsRef.current,
          e.clientX,
          e.clientY,
        );
        const line = id ? drawingsRef.current.find((x) => x.id === id && x.type === 'line') : null;
        if (!line) {
          setLineHandleState((prev) => (prev ? null : prev));
          return;
        }
        const handle = findLineHandleAtPointer(chart2, series, stack, line, e.clientX, e.clientY);
        if (!handle) {
          setLineHandleState((prev) => (prev ? null : prev));
          return;
        }
        setLineHandleState((prev) => {
          if (prev && prev.drawingId === line.id && prev.handle === handle && !prev.dragging) return prev;
          return { drawingId: line.id, handle, dragging: false };
        });
      };

      const onDblClick = (e) => {
        if (!root.contains(e.target)) return;
        if (drawToolRef.current !== DRAW_TOOLS.pan || !drawingsVisibleRef.current) return;
        const chart2 = chartApiRef.current;
        const series = mainSeriesRef.current;
        const stack = chartStackRef.current;
        if (!chart2 || !series || !stack) return;
        const id = findDrawingIdAtPointer(
          chart2,
          series,
          stack,
          drawingsRef.current,
          e.clientX,
          e.clientY,
        );
        if (!id) return;
        const d = drawingsRef.current.find((x) => x.id === id);
        if (!d || d.type !== 'text') return;
        e.preventDefault();
        e.stopPropagation();
        setTextDraft(d.text || '');
        setTextPrompt({
          x: e.clientX,
          y: e.clientY,
          time: d.time,
          price: d.price,
          drawingId: d.id,
        });
      };

      root.addEventListener('pointerdown', onPointerDown, true);
      root.addEventListener('pointermove', onPointerMove, true);
      root.addEventListener('dblclick', onDblClick, true);
      detach = () => {
        root.removeEventListener('pointerdown', onPointerDown, true);
        root.removeEventListener('pointermove', onPointerMove, true);
        root.removeEventListener('dblclick', onDblClick, true);
      };
    };

    attach();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      detach();
      const canvas = chartApiRef.current && getMainPaneInteractionCanvas(chartApiRef.current);
      const s = textDragSessionRef.current;
      if (s && canvas) releasePointerIfAny(canvas, s.pointerId);
      textDragSessionRef.current = null;
      setLineHandleState(null);
    };
  }, [
    drawTool,
    drawingsVisible,
    symbol,
    loading,
    bars.length,
    timeframe,
    chartType,
    inds,
    chartLayout,
    mainChartHeight,
    candleBarSpacing,
    theme,
    palette,
  ]);

  useEffect(() => {
    const canvas = chartApiRef.current && getMainPaneInteractionCanvas(chartApiRef.current);
    if (!canvas) return undefined;
    if (drawTool === DRAW_TOOLS.pan) {
      canvas.style.cursor = lineHandleState ? 'pointer' : '';
      return undefined;
    }
    canvas.style.cursor = 'crosshair';
    return () => {
      canvas.style.cursor = '';
    };
  }, [drawTool, lineHandleState, symbol, loading, bars.length, chartType, inds, chartLayout, mainChartHeight, candleBarSpacing, theme, palette]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setContextMenu(null);
      setTextPrompt(null);
      setTextDraft('');
      setDraftShape(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Magnet crosshair can make manual hit-testing miss; use normal mode while drawing. */
  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return undefined;
    try {
      chart.applyOptions({
        crosshair: { mode: drawTool === DRAW_TOOLS.pan ? CrosshairMode.Magnet : CrosshairMode.Normal },
      });
    } catch (_) {}
  }, [drawTool]);

  const browserNotifyPermission = useMemo(() => {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  }, [notifyPermRev]);

  const wrapStyle = {
    ...s.wrapper,
    ...(chartLayout === CHART_LAYOUT.expanded
      ? {
          position: 'fixed',
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 2000,
          margin: 0,
          maxWidth: 'none',
          overflow: 'auto',
          borderRadius: 0,
          padding: '12px 16px 16px',
          boxShadow: '0 0 0 9999px var(--shadow-overlay)',
        }
      : {}),
  };

  if (!symbol) {
    return (
      <div style={s.wrapper}>
        <div style={s.empty}>Select a symbol from the watchlist</div>
      </div>
    );
  }

  if (chartLayout === CHART_LAYOUT.minimized) {
    return (
      <div style={s.wrapper}>
        <div style={s.minimizedBar}>
          <button type="button" style={s.tfBtn(false)} onClick={() => setChartLayout(CHART_LAYOUT.normal)}>
            ▲ Expand chart
          </button>
          <span style={{ fontWeight: 700 }}>{symbol}</span>
          <span style={{ color: 'var(--text-secondary)' }}>{price != null ? `$${Number(price).toFixed(2)}` : '—'}</span>
          <button type="button" style={s.layoutBtn(false)} onClick={() => setChartLayout(CHART_LAYOUT.expanded)}>
            Full screen
          </button>
        </div>
      </div>
    );
  }

  const chartInst = chartApiRef.current;
  const seriesInst = mainSeriesRef.current;
  const stackEl = chartStackRef.current;

  return (
    <div style={wrapStyle} ref={wrapRef}>
      {chartLayout === CHART_LAYOUT.expanded && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 10, gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Full screen chart — Esc to exit</span>
          <button type="button" style={s.tfBtn(false)} onClick={() => setChartLayout(CHART_LAYOUT.normal)}>
            Exit full screen
          </button>
        </div>
      )}

      {alertToast && (
        <div
          role="status"
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-success-soft)',
            color: 'var(--text-primary)',
            fontSize: 13,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <span style={{ lineHeight: 1.45 }}>{alertToast.text}</span>
          <button
            type="button"
            style={{ ...s.actionBtn, flexShrink: 0 }}
            onClick={() => setAlertToast(null)}
            aria-label="Dismiss alert"
          >
            ×
          </button>
        </div>
      )}

      <div style={s.topRow}>
        <div>
          <div style={s.symbolName}>{symbol}</div>
          {snapshot?.asset_class === 'option' && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              {ivPct != null && <span>IV {ivPct.toFixed(2)}% · </span>}
              {snapshot.greeks && (
                <span>Δ {snapshot.greeks.delta.toFixed(3)} · Θ {snapshot.greeks.theta.toFixed(4)}</span>
              )}
            </div>
          )}
          <div style={s.priceRow}>
            <span style={s.currentPrice}>{price ? `$${Number(price).toFixed(2)}` : '—'}</span>
            {changePct != null && (
              <span style={s.changeBadge(changePct)}>
                {change >= 0 ? '+' : ''}{change.toFixed(2)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
              </span>
            )}
          </div>
          {chartLayout !== CHART_LAYOUT.expanded && (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              <button
                type="button"
                style={s.fullScreenBtn}
                title="Use the full window for the chart (Esc to exit)"
                onClick={openFullScreenChart}
              >
                Full screen chart
              </button>
              <span style={s.fullScreenHint}>Maximize chart area · Esc to return</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ ...s.tfRow, justifyContent: 'flex-end' }}>
            <span style={{ marginRight: 6, fontSize: 11, color: 'var(--text-muted)' }}>Chart</span>
            <button
              type="button"
              style={s.layoutBtn(false)}
              title="Reset zoom and pan to full data"
              onClick={resetChartView}
            >
              Reset view
            </button>
            <button
              type="button"
              style={s.layoutBtn(false)}
              title="Collapse chart to a slim bar"
              onClick={() => setChartLayout(CHART_LAYOUT.minimized)}
            >
              Minimize
            </button>
            <button
              type="button"
              style={s.layoutBtn(chartLayout === CHART_LAYOUT.expanded)}
              title="Full-window chart view"
              onClick={openFullScreenChart}
            >
              Full screen
            </button>
          </div>
          <div style={s.tfRow}>
            <select
              value={chartType}
              onChange={(e) => setChartType(e.target.value)}
              style={{ ...s.layoutBtn(false), padding: '4px 8px', background: 'var(--bg-input)' }}
              title="Chart type"
            >
              {CHART_TYPE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {TIMEFRAMES.map((tf) => (
              <button key={tf} type="button" style={s.tfBtn(timeframe === tf)} onClick={() => setTimeframe(tf)}>
                {timeframeLabel(tf)}
              </button>
            ))}
            <span
              title={liveBarsUpdatedAt ? `Last bar refresh: ${new Date(liveBarsUpdatedAt).toLocaleTimeString()}` : 'Waiting for bar refresh...'}
              style={{
                marginLeft: 4,
                fontSize: 11,
                borderRadius: 999,
                border: '1px solid var(--border)',
                padding: '3px 8px',
                background: liveAgeSec != null && liveAgeSec < 15 ? 'var(--bg-success-soft)' : 'var(--bg-input)',
                color: liveAgeSec != null && liveAgeSec < 15 ? 'var(--success)' : 'var(--text-secondary)',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              {liveBadgeText}
            </span>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={s.empty}>Loading chart…</div>
      ) : !bars.length ? (
        <div style={s.empty}>No data available</div>
      ) : (
        <>
          <div
            ref={chartStackRef}
            style={{ ...s.chartStack, height: mainChartHeight, marginBottom: 10 }}
            onContextMenu={onChartContextMenu}
          >
            <div ref={mainRef} style={s.chartHost} />
            {drawingsVisible && (
              <DrawingSvg
                chart={chartInst}
                series={seriesInst}
                stackEl={stackEl}
                width={stackSize.w}
                height={stackSize.h}
                drawings={drawings}
                draftShape={draftShape}
                overlay={drawOverlay}
                lineHandleState={lineHandleState}
              />
            )}
          </div>
          {inds.rsi && <div ref={rsiRef} style={s.subHost} />}
          {inds.macd && <div ref={macdRef} style={s.subHost} />}
        </>
      )}

      <div style={s.toolsRow}>
        <span style={s.toolsLabel}>
          Drawings · Space = pan · ⌃/⌘Z undo · ⌃/⌘⇧Z redo · ⌃Y redo · Del last
        </span>
        <div style={s.toolsGroup}>
          {[
            [
              DRAW_TOOLS.pan,
              '⎋',
              'Crosshair / pan — drag text labels to move; double-click text to edit',
            ],
            [DRAW_TOOLS.line, '╱', 'Trend line — pan mode: drag endpoints to adjust'],
            [DRAW_TOOLS.arrow, '↗', 'Arrow (direction)'],
            [DRAW_TOOLS.hline, '—', 'Horizontal line'],
            [DRAW_TOOLS.box, '▭', 'Rectangle'],
            [DRAW_TOOLS.text, 'T', 'Text label'],
            [DRAW_TOOLS.marker, '●', 'Dot marker'],
          ].map(([key, sym, title]) => (
            <button
              key={key}
              type="button"
              style={{ ...s.toolBtn(drawTool === key), minWidth: 34, fontSize: 15, lineHeight: 1 }}
              onClick={() => pickDrawTool(key)}
              title={
                key === DRAW_TOOLS.pan
                  ? `${title} — hold Space to pan while another tool is selected`
                  : `${title} — click-drag on chart; hold Space to pan`
              }
            >
              {sym}
            </button>
          ))}
        </div>
        <span style={s.toolsDivider} aria-hidden />
        <div style={s.toolsGroup}>
          <button
            type="button"
            style={{ ...s.actionBtn, color: 'var(--danger)' }}
            onClick={() => commitDrawings([])}
          >
            Clear
          </button>
          <button
            type="button"
            style={s.actionBtn}
            onClick={undoDrawings}
            disabled={!drawHistory.length}
            title="Keyboard: ⌃/⌘Z"
          >
            Undo
          </button>
          <button
            type="button"
            style={s.actionBtn}
            onClick={redoDrawings}
            disabled={!drawFuture.length}
            title="Keyboard: ⌃/⌘⇧Z or ⌃Y (Windows)"
          >
            Redo
          </button>
          <button
            type="button"
            style={s.actionBtn}
            onClick={() => commitDrawings((p) => p.slice(0, -1))}
            disabled={!drawings.length}
            title="Keyboard: Delete (Fn+⌫ on some keyboards)"
          >
            Delete last
          </button>
          <button type="button" style={s.actionBtn} onClick={() => setDrawingsVisible((v) => !v)}>
            {drawingsVisible ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {drawingsVisible && drawings.length > 0 && (
        <div
          style={{
            margin: '0 0 8px',
            padding: '6px 10px 8px',
            maxHeight: 112,
            overflowY: 'auto',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-surface)',
            fontSize: 11,
          }}
        >
          <div style={{ color: 'var(--text-muted)', marginBottom: 6 }}>Drawings on chart</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[...drawings].reverse().map((d) => (
              <div
                key={d.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  minHeight: 26,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'var(--text-primary)',
                  }}
                  title={drawingListLabel(d)}
                >
                  {drawingListLabel(d)}
                </span>
                <button
                  type="button"
                  title="Remove"
                  onClick={() => commitDrawings((prev) => prev.filter((x) => x.id !== d.id))}
                  style={{
                    flex: '0 0 auto',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '2px 8px',
                    fontSize: 12,
                    lineHeight: 1.2,
                    background: 'var(--bg-input)',
                    color: 'var(--danger)',
                    cursor: 'pointer',
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {todayBar && (
        <div style={s.ohlc}>
          <span>O <span style={s.ohlcVal}>${todayBar.open.toFixed(2)}</span></span>
          <span>H <span style={{ ...s.ohlcVal, color: 'var(--success)' }}>${todayBar.high.toFixed(2)}</span></span>
          <span>L <span style={{ ...s.ohlcVal, color: 'var(--danger)' }}>${todayBar.low.toFixed(2)}</span></span>
          <span>C <span style={s.ohlcVal}>${todayBar.close.toFixed(2)}</span></span>
          <span>Vol <span style={s.ohlcVal}>{Number(todayBar.volume).toLocaleString()}</span></span>
        </div>
      )}

      <div style={{ ...s.panel, marginBottom: 10 }}>
        <div style={{ ...s.panelHead, cursor: 'default', marginBottom: 8 }}>
          <span>Live Trade</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {symbolIsOption ? 'Option quick order' : 'Equity quick order'}{livePrice != null ? ` · $${livePrice.toFixed(2)}` : ''}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 130px 1fr', gap: 8, alignItems: 'center' }}>
          <input
            value={quickQty}
            onChange={(e) => setQuickQty(e.target.value)}
            placeholder="Qty"
            style={{ ...s.actionBtn, width: '100%', padding: '7px 8px' }}
          />
          <input
            value={quickLimitPrice}
            onChange={(e) => setQuickLimitPrice(e.target.value)}
            placeholder={livePrice != null ? `Limit ${livePrice.toFixed(2)}` : 'Limit price'}
            style={{ ...s.actionBtn, width: '100%', padding: '7px 8px' }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={tradeSubmitting}
              onClick={() => submitQuickOrder('buy', 'market')}
              style={{ ...s.actionBtn, padding: '7px 10px', borderColor: 'transparent', background: 'var(--success)', color: 'var(--accent-contrast)' }}
            >
              Buy MKT
            </button>
            <button
              type="button"
              disabled={tradeSubmitting}
              onClick={() => submitQuickOrder('sell', 'market')}
              style={{ ...s.actionBtn, padding: '7px 10px', borderColor: 'transparent', background: 'var(--danger)', color: 'var(--accent-contrast)' }}
            >
              Sell MKT
            </button>
            <button
              type="button"
              disabled={tradeSubmitting}
              onClick={() => submitQuickOrder('buy', 'limit')}
              style={{ ...s.actionBtn, padding: '7px 10px', borderColor: 'var(--success)', color: 'var(--success)' }}
            >
              Buy LMT
            </button>
            <button
              type="button"
              disabled={tradeSubmitting}
              onClick={() => submitQuickOrder('sell', 'limit')}
              style={{ ...s.actionBtn, padding: '7px 10px', borderColor: 'var(--danger)', color: 'var(--danger)' }}
            >
              Sell LMT
            </button>
          </div>
        </div>
        {tradeStatus && (
          <div style={{ marginTop: 8, fontSize: 12, color: tradeStatus.type === 'success' ? 'var(--success)' : 'var(--danger)' }}>
            {tradeStatus.msg}
          </div>
        )}
      </div>

      <div style={{ ...s.panel, marginBottom: 10 }}>
        <div style={{ ...s.panelHead, cursor: 'default', marginBottom: 8 }}>
          <span>Hedging Strategies</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Quick expiry payoff preview</span>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr', gap: 8 }}>
            <select
              value={hedgeStrategy}
              onChange={(e) => setHedgeStrategy(e.target.value)}
              style={{ ...s.actionBtn, padding: '6px 8px', background: 'var(--bg-input)' }}
            >
              {Object.entries(HEDGE_STRATEGIES).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <input
              value={hedgeForm.shares}
              onChange={(e) => setHedgeForm((p) => ({ ...p, shares: e.target.value }))}
              placeholder="Shares"
              style={{ ...s.actionBtn, padding: '6px 8px' }}
            />
            <input
              value={livePrice != null ? livePrice.toFixed(2) : ''}
              readOnly
              placeholder="Spot"
              style={{ ...s.actionBtn, padding: '6px 8px', opacity: 0.85 }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', alignSelf: 'center' }}>
              Live spot from snapshot
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
            <input value={hedgeForm.putStrike} onChange={(e) => setHedgeForm((p) => ({ ...p, putStrike: e.target.value }))} placeholder="Put strike" style={{ ...s.actionBtn, padding: '6px 8px' }} />
            <input value={hedgeForm.putPremium} onChange={(e) => setHedgeForm((p) => ({ ...p, putPremium: e.target.value }))} placeholder="Put premium" style={{ ...s.actionBtn, padding: '6px 8px' }} />
            <input value={hedgeForm.callStrike} onChange={(e) => setHedgeForm((p) => ({ ...p, callStrike: e.target.value }))} placeholder="Call strike" style={{ ...s.actionBtn, padding: '6px 8px' }} />
            <input value={hedgeForm.callPremium} onChange={(e) => setHedgeForm((p) => ({ ...p, callPremium: e.target.value }))} placeholder="Call premium" style={{ ...s.actionBtn, padding: '6px 8px' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              disabled={hedgeAutoLoading}
              onClick={autoFillHedgeFromChain}
              style={{ ...s.actionBtn, padding: '6px 10px' }}
            >
              {hedgeAutoLoading ? 'Auto-filling...' : 'Auto-fill from chain'}
            </button>
            <button
              type="button"
              disabled={hedgeSubmitLoading}
              onClick={submitHedgeOrders}
              style={{ ...s.actionBtn, padding: '6px 10px', borderColor: 'transparent', background: 'var(--accent-strong)', color: 'var(--accent-contrast)' }}
            >
              {hedgeSubmitLoading ? 'Submitting...' : 'Submit hedge legs'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Contracts: {contractQtyFromShares(hedgeForm.shares)} · Exp: {hedgeContracts.expiration || '—'}
            </span>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={includeStockLeg}
              onChange={(e) => setIncludeStockLeg(e.target.checked)}
            />
            Include stock leg (BUY {Math.max(1, Math.round(toFinite(hedgeForm.shares, 100)))} {inferUnderlying(symbol)} shares)
          </label>
          {(hedgeContracts.putSymbol || hedgeContracts.callSymbol) && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {hedgeContracts.putSymbol ? `Put: ${hedgeContracts.putSymbol}` : 'Put: —'} · {hedgeContracts.callSymbol ? `Call: ${hedgeContracts.callSymbol}` : 'Call: —'}
            </div>
          )}
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, background: 'var(--bg-input)' }}>
            <svg width="100%" height={hedgeCurvePoints.height + 24} viewBox={`0 0 ${hedgeCurvePoints.width} ${hedgeCurvePoints.height + 24}`} preserveAspectRatio="none">
              <line x1="0" y1={hedgeCurvePoints.zeroY} x2={hedgeCurvePoints.width} y2={hedgeCurvePoints.zeroY} stroke="var(--border)" strokeWidth="1" />
              <polyline points={hedgeCurvePoints.path} fill="none" stroke="var(--accent-strong)" strokeWidth="2.2" />
              <text x="0" y={hedgeCurvePoints.height + 16} fill="var(--text-muted)" fontSize="10">
                {hedgeCurvePoints.minPx.toFixed(2)}
              </text>
              <text x={hedgeCurvePoints.width / 2 - 26} y={hedgeCurvePoints.height + 16} fill="var(--text-muted)" fontSize="10">
                Spot {Math.max(0.01, livePrice || 1).toFixed(2)}
              </text>
              <text x={hedgeCurvePoints.width - 38} y={hedgeCurvePoints.height + 16} fill="var(--text-muted)" fontSize="10">
                {hedgeCurvePoints.maxPx.toFixed(2)}
              </text>
            </svg>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, fontSize: 12 }}>
            <div><span style={{ color: 'var(--text-secondary)' }}>Max profit:</span> <span style={{ color: 'var(--success)' }}>{hedgePreview.maxProfit}</span></div>
            <div><span style={{ color: 'var(--text-secondary)' }}>Max loss:</span> <span style={{ color: 'var(--danger)' }}>{hedgePreview.maxLoss}</span></div>
            <div><span style={{ color: 'var(--text-secondary)' }}>Breakeven:</span> <span>{hedgePreview.breakeven}</span></div>
            <div style={{ color: 'var(--text-secondary)' }}>{hedgePreview.note}</div>
          </div>
          {hedgeStatus && (
            <div style={{ fontSize: 12, color: hedgeStatus.type === 'success' ? 'var(--success)' : 'var(--danger)' }}>
              {hedgeStatus.msg}
            </div>
          )}
        </div>
      </div>

      <div style={s.panel}>
        <button type="button" style={{ ...s.panelHead, width: '100%', border: 'none', background: 'transparent' }} onClick={() => setPanelOpen((p) => !p)}>
          <span>Indicators &amp; overlays</span>
          <span>{panelOpen ? '▼' : '▶'}</span>
        </button>
        {panelOpen && (
          <div style={s.gridChecks}>
            {[
              ['volume', 'Volume'],
              ['vwap', 'VWAP (session cum.)'],
              ['sma9', 'SMA 9'],
              ['sma20', 'SMA 20'],
              ['wma20', 'WMA 20'],
              ['sma50', 'SMA 50'],
              ['sma100', 'SMA 100'],
              ['sma200', 'SMA 200'],
              ['ema12', 'EMA 12'],
              ['ema26', 'EMA 26'],
              ['ema50', 'EMA 50'],
              ['ema200', 'EMA 200'],
              ['bb', 'Bollinger (20, 2σ)'],
              ['donchian', 'Donchian 20'],
              ['rsi', 'RSI 14 (pane)'],
              ['atr14', 'ATR 14'],
              ['macd', 'MACD 12/26/9 (pane)'],
              ['tradeSignals', 'Buy/sell markers (MACD histogram zero-cross)'],
            ].map(([key, label]) => (
              <label key={key} style={s.checkLabel}>
                <input
                  type="checkbox"
                  checked={inds[key]}
                  onChange={(e) => setInd(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
        )}
      </div>

      <div style={s.panel}>
        <button
          type="button"
          style={{ ...s.panelHead, width: '100%', border: 'none', background: 'transparent' }}
          onClick={() => setAlertsPanelOpen((p) => !p)}
        >
          <span>Alerts</span>
          <span>{alertsPanelOpen ? '▼' : '▶'}</span>
        </button>
        {alertsPanelOpen && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.45 }}>
              Rules run in your browser when bars refresh (poll / merge). They evaluate the latest bar vs the prior bar.
              Enable desktop notifications for OS-level banners. Not investment advice.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
              <button
                type="button"
                style={s.actionBtn}
                onClick={requestNotifyPermission}
                disabled={browserNotifyPermission === 'unsupported'}
                title="Ask the browser for notification permission"
              >
                Enable desktop notifications
              </button>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Permission:
                {' '}
                {browserNotifyPermission === 'unsupported' ? 'not supported' : browserNotifyPermission}
              </span>
              <label style={{ ...s.checkLabel, marginLeft: 'auto' }}>
                <input
                  type="checkbox"
                  checked={desktopAlertNotify}
                  onChange={(e) => setDesktopAlertNotify(e.target.checked)}
                  disabled={browserNotifyPermission !== 'granted'}
                />
                Desktop push when firing
              </label>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
                Condition
                <select
                  value={alertDraftType}
                  onChange={(e) => {
                    setAlertDraftType(e.target.value);
                    setAlertDraftError('');
                  }}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    minWidth: 220,
                  }}
                >
                  {CHART_ALERT_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </label>
              {alertDraftMeta?.needsThreshold && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
                  {alertDraftMeta.inputKind === 'price'
                    ? 'Price level'
                    : alertDraftMeta.inputKind === 'period'
                      ? 'Lookback bars (N)'
                      : 'RSI level'}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={alertDraftThreshold}
                    onChange={(e) => {
                      setAlertDraftThreshold(e.target.value);
                      setAlertDraftError('');
                    }}
                    placeholder={alertDraftMeta.placeholder ?? ''}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      width: 120,
                    }}
                  />
                </label>
              )}
              <button type="button" style={{ ...s.fullScreenBtn, padding: '6px 14px', fontSize: 12 }} onClick={addChartAlert}>
                Add alert for {symbol}
              </button>
            </div>
            {alertDraftError && (
              <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>{alertDraftError}</div>
            )}
            {alertsForSymbol.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No alerts for {symbol} yet.</div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {alertsForSymbol.map((a) => (
                  <li
                    key={a.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-surface)',
                      fontSize: 12,
                    }}
                  >
                    <label style={{ ...s.checkLabel, flex: 1, minWidth: 160 }}>
                      <input
                        type="checkbox"
                        checked={a.enabled}
                        onChange={(e) =>
                          setChartAlerts((prev) =>
                            prev.map((x) => (x.id === a.id ? { ...x, enabled: e.target.checked } : x)),
                          )
                        }
                      />
                      <span>{formatChartAlertSummary(a)}</span>
                    </label>
                    <button
                      type="button"
                      style={{ ...s.actionBtn, color: 'var(--danger)' }}
                      onClick={() => setChartAlerts((prev) => prev.filter((x) => x.id !== a.id))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {textPrompt && (
        <div
          role="dialog"
          aria-label="Chart text label"
          style={{
            position: 'fixed',
            left: Math.max(
              8,
              Math.min(
                textPrompt.x - 100,
                (typeof window !== 'undefined' ? window.innerWidth : 800) - 228,
              ),
            ),
            top: Math.max(8, textPrompt.y - 56),
            zIndex: 5000,
            width: 220,
            padding: 10,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: 'var(--shadow-context)',
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
            {textPrompt.drawingId ? 'Edit text label' : 'Text label'}
          </div>
          <input
            ref={textInputRef}
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitTextPrompt();
              }
              if (e.key === 'Escape') {
                setTextPrompt(null);
                setTextDraft('');
              }
            }}
            placeholder="Type label…"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              fontSize: 13,
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
            <button type="button" style={s.actionBtn} onClick={() => { setTextPrompt(null); setTextDraft(''); }}>
              Cancel
            </button>
            <button
              type="button"
              style={{
                ...s.actionBtn,
                background: 'var(--accent-strong)',
                color: 'var(--accent-contrast)',
                borderColor: 'transparent',
              }}
              onClick={() => submitTextPrompt()}
            >
              {textPrompt.drawingId ? 'Save' : 'Place'}
            </button>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 3000,
            minWidth: 200,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 10px 26px var(--shadow-context)',
            padding: 6,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {contextMenu.drawingId && (
            <>
              <button
                type="button"
                onClick={() => {
                  const id = contextMenu.drawingId;
                  commitDrawings((prev) => prev.filter((d) => d.id !== id));
                  setContextMenu(null);
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 10px',
                  background: 'transparent',
                  color: 'var(--danger)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Remove this drawing
              </button>
              <div
                style={{
                  height: 1,
                  background: 'var(--border)',
                  margin: '8px 4px',
                }}
              />
              {(() => {
                const hitDraw = drawings.find((d) => d.id === contextMenu.drawingId);
                if (!hitDraw || hitDraw.type !== 'text') return null;
                return (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setTextDraft(hitDraw.text || '');
                        setTextPrompt({
                          x: contextMenu.x,
                          y: contextMenu.y,
                          time: hitDraw.time,
                          price: hitDraw.price,
                          drawingId: hitDraw.id,
                        });
                        setContextMenu(null);
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        border: 'none',
                        borderRadius: 6,
                        padding: '8px 10px',
                        background: 'transparent',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      Edit label…
                    </button>
                    <div
                      style={{
                        height: 1,
                        background: 'var(--border)',
                        margin: '8px 4px',
                      }}
                    />
                  </>
                );
              })()}
            </>
          )}
          {[
            {
              key: 'reset',
              label: 'Reset view',
              action: () => {
                resetChartView();
                setContextMenu(null);
              },
            },
            {
              key: 'zoomIn',
              label: 'Zoom in candles',
              action: () => {
                zoomCandles(2);
                setContextMenu(null);
              },
            },
            {
              key: 'zoomOut',
              label: 'Zoom out candles',
              action: () => {
                zoomCandles(-2);
                setContextMenu(null);
              },
            },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.action}
              style={{
                width: '100%',
                textAlign: 'left',
                border: 'none',
                borderRadius: 6,
                padding: '8px 10px',
                background: 'transparent',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {item.label}
            </button>
          ))}

          {contextMenu.hit && (
            <>
              <div
                style={{
                  height: 1,
                  background: 'var(--border)',
                  margin: '8px 4px',
                }}
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 8px 6px' }}>Drawings</div>
              {[
                {
                  key: 'ctx-line',
                  label: 'Trend line from here',
                  action: () => {
                    const ch = chartApiRef.current;
                    const h = contextMenu.hit;
                    if (!ch || !h) return;
                    const seg = buildShortTrendLine(ch, h);
                    if (seg) {
                      commitDrawings((prev) => [
                        ...prev,
                        { id: newDrawingId(), type: 'line', ...seg },
                      ]);
                    }
                    setContextMenu(null);
                  },
                },
                {
                  key: 'ctx-text',
                  label: 'Add text label…',
                  action: () => {
                    const h = contextMenu.hit;
                    if (!h) return;
                    setTextDraft('');
                    setTextPrompt({ x: contextMenu.x, y: contextMenu.y, time: h.time, price: h.price });
                    setContextMenu(null);
                  },
                },
                {
                  key: 'ctx-arrow-up',
                  label: 'Up arrow (bullish)',
                  action: () => {
                    const ch = chartApiRef.current;
                    const h = contextMenu.hit;
                    if (!ch || !h) return;
                    const seg = buildArrowUpSegment(ch, h);
                    if (seg) {
                      commitDrawings((prev) => [
                        ...prev,
                        { id: newDrawingId(), type: 'arrow', ...seg },
                      ]);
                    }
                    setContextMenu(null);
                  },
                },
                {
                  key: 'ctx-arrow-down',
                  label: 'Down arrow (bearish)',
                  action: () => {
                    const ch = chartApiRef.current;
                    const h = contextMenu.hit;
                    if (!ch || !h) return;
                    const seg = buildArrowDownSegment(ch, h);
                    if (seg) {
                      commitDrawings((prev) => [
                        ...prev,
                        { id: newDrawingId(), type: 'arrow', ...seg },
                      ]);
                    }
                    setContextMenu(null);
                  },
                },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.action}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    border: 'none',
                    borderRadius: 6,
                    padding: '8px 10px',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  {item.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* {chartLayout !== CHART_LAYOUT.expanded && (
        <div style={s.foot}>
          Charting:{' '}
          <a href="https://www.tradingview.com/lightweight-charts/" style={{ color: 'var(--accent)' }} target="_blank" rel="noreferrer">
            Lightweight Charts
          </a>{' '}
          · Drawings are stored per symbol in the browser. © TradingView — TV-grade scripting is not bundled; studies are computed locally from Alpaca
          bars.
        </div>
      )} */}
    </div>
  );
}
