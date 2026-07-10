import { barTimeSeconds, seriesMACD, seriesRSI } from '../../utils/indicators';

/** Condition presets (TradingView-style rule alerts). */
export const CHART_ALERT_TYPES = [
  { id: 'close_cross_above', label: 'Close crosses above', needsThreshold: true, inputKind: 'price' },
  { id: 'close_cross_below', label: 'Close crosses below', needsThreshold: true, inputKind: 'price' },
  { id: 'macd_hist_buy', label: 'MACD histogram bullish (zero cross)', needsThreshold: false },
  { id: 'macd_hist_sell', label: 'MACD histogram bearish (zero cross)', needsThreshold: false },
  { id: 'rsi_cross_above', label: 'RSI crosses above level', needsThreshold: true, inputKind: 'rsi', placeholder: '70' },
  { id: 'rsi_cross_below', label: 'RSI crosses below level', needsThreshold: true, inputKind: 'rsi', placeholder: '30' },
  { id: 'pattern_bull_engulf', label: 'Pattern: bullish engulfing (buy)', needsThreshold: false },
  { id: 'pattern_bear_engulf', label: 'Pattern: bearish engulfing (sell)', needsThreshold: false },
  { id: 'pattern_hammer', label: 'Pattern: hammer (buy bias)', needsThreshold: false },
  { id: 'pattern_shooting_star', label: 'Pattern: shooting star (sell bias)', needsThreshold: false },
  {
    id: 'pattern_breakout_high',
    label: 'Pattern: close breaks prior N-bar high (buy)',
    needsThreshold: true,
    inputKind: 'period',
    placeholder: '20',
  },
  {
    id: 'pattern_breakdown_low',
    label: 'Pattern: close breaks prior N-bar low (sell)',
    needsThreshold: true,
    inputKind: 'period',
    placeholder: '20',
  },
];

function barOHLC(b) {
  const o = Number(b.open);
  const h = Number(b.high);
  const l = Number(b.low);
  const c = Number(b.close);
  if (![o, h, l, c].every((x) => Number.isFinite(x))) return null;
  return { o, h, l, c };
}

/** Bullish engulfing: prior bearish candle fully engulfed by current bullish body. */
function isBullishEngulfing(prev, curr) {
  const p = barOHLC(prev);
  const c = barOHLC(curr);
  if (!p || !c) return false;
  if (p.o <= p.c) return false;
  if (c.c <= c.o) return false;
  return c.o <= p.c && c.c >= p.o;
}

/** Bearish engulfing: prior bullish candle fully engulfed by current bearish body. */
function isBearishEngulfing(prev, curr) {
  const p = barOHLC(prev);
  const c = barOHLC(curr);
  if (!p || !c) return false;
  if (p.c <= p.o) return false;
  if (c.o <= c.c) return false;
  return c.o >= p.c && c.c <= p.o;
}

/**
 * Hammer: long lower wick, small real body near top of range (classic dip-buying pressure).
 */
function isHammer(b) {
  const x = barOHLC(b);
  if (!x) return false;
  const { o, h, l, c } = x;
  const range = h - l;
  if (range <= 0) return false;
  const body = Math.abs(c - o);
  const upper = h - Math.max(o, c);
  const lower = Math.min(o, c) - l;
  if (body < range * 0.08) {
    return lower >= range * 0.55 && upper <= range * 0.2;
  }
  return lower >= body * 2 && upper <= Math.max(body * 0.55, range * 0.12);
}

/**
 * Shooting star: long upper wick, small body near bottom (rejection at highs).
 */
function isShootingStar(b) {
  const x = barOHLC(b);
  if (!x) return false;
  const { o, h, l, c } = x;
  const range = h - l;
  if (range <= 0) return false;
  const body = Math.abs(c - o);
  const upper = h - Math.max(o, c);
  const lower = Math.min(o, c) - l;
  if (body < range * 0.08) {
    return upper >= range * 0.55 && lower <= range * 0.2;
  }
  return upper >= body * 2 && lower <= Math.max(body * 0.55, range * 0.12);
}

export function chartAlertTypeMeta(typeId) {
  return CHART_ALERT_TYPES.find((t) => t.id === typeId);
}

export function formatChartAlertSummary(alert) {
  const meta = chartAlertTypeMeta(alert.type);
  const base = meta?.label ?? alert.type;
  if (!meta?.needsThreshold) return base;
  const v = alert.threshold;
  if (meta.inputKind === 'price' && Number.isFinite(Number(v))) return `${base} ($${Number(v).toFixed(2)})`;
  if (meta.inputKind === 'rsi' && Number.isFinite(Number(v))) return `${base} (${Number(v)})`;
  if (meta.inputKind === 'period' && Number.isFinite(Number(v))) return `${base} (N=${Math.round(Number(v))})`;
  return base;
}

/**
 * @param {object} alert — persisted alert row
 * @param {object[]} bars — chronological OHLC bars for one symbol
 * @returns {{ message: string } | null}
 */
export function evaluateChartAlert(alert, bars) {
  if (!alert?.enabled || !Array.isArray(bars) || bars.length < 2) return null;
  const curr = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const currT = curr.time;
  if (alert.lastFiredBarTime != null && String(alert.lastFiredBarTime) === String(currT)) return null;

  const pc = Number(prev.close);
  const cc = Number(curr.close);
  if (!Number.isFinite(pc) || !Number.isFinite(cc)) return null;

  switch (alert.type) {
    case 'close_cross_above': {
      const v = Number(alert.threshold);
      if (!Number.isFinite(v)) return null;
      if (pc <= v && cc > v) {
        return { message: `Close crossed above $${v.toFixed(2)} (now $${cc.toFixed(2)})` };
      }
      return null;
    }
    case 'close_cross_below': {
      const v = Number(alert.threshold);
      if (!Number.isFinite(v)) return null;
      if (pc >= v && cc < v) {
        return { message: `Close crossed below $${v.toFixed(2)} (now $${cc.toFixed(2)})` };
      }
      return null;
    }
    case 'macd_hist_buy': {
      const { histogram } = seriesMACD(bars, 12, 26, 9);
      if (histogram.length < 2) return null;
      const hp = histogram[histogram.length - 2];
      const hc = histogram[histogram.length - 1];
      if (hc.time !== barTimeSeconds(curr)) return null;
      if (hp.value <= 0 && hc.value > 0) {
        return { message: 'MACD histogram crossed above zero' };
      }
      return null;
    }
    case 'macd_hist_sell': {
      const { histogram } = seriesMACD(bars, 12, 26, 9);
      if (histogram.length < 2) return null;
      const hp = histogram[histogram.length - 2];
      const hc = histogram[histogram.length - 1];
      if (hc.time !== barTimeSeconds(curr)) return null;
      if (hp.value >= 0 && hc.value < 0) {
        return { message: 'MACD histogram crossed below zero' };
      }
      return null;
    }
    case 'rsi_cross_above': {
      const level = Number(alert.threshold ?? 70);
      if (!Number.isFinite(level)) return null;
      const rsi = seriesRSI(bars, 14);
      if (rsi.length < 2) return null;
      if (rsi[rsi.length - 1].time !== barTimeSeconds(curr)) return null;
      const rp = rsi[rsi.length - 2].value;
      const rc = rsi[rsi.length - 1].value;
      if (rp <= level && rc > level) {
        return { message: `RSI crossed above ${level} (now ${rc.toFixed(1)})` };
      }
      return null;
    }
    case 'rsi_cross_below': {
      const level = Number(alert.threshold ?? 30);
      if (!Number.isFinite(level)) return null;
      const rsi = seriesRSI(bars, 14);
      if (rsi.length < 2) return null;
      if (rsi[rsi.length - 1].time !== barTimeSeconds(curr)) return null;
      const rp = rsi[rsi.length - 2].value;
      const rc = rsi[rsi.length - 1].value;
      if (rp >= level && rc < level) {
        return { message: `RSI crossed below ${level} (now ${rc.toFixed(1)})` };
      }
      return null;
    }
    case 'pattern_bull_engulf': {
      if (isBullishEngulfing(prev, curr)) {
        return { message: 'Bullish engulfing candle (buy-side pattern)' };
      }
      return null;
    }
    case 'pattern_bear_engulf': {
      if (isBearishEngulfing(prev, curr)) {
        return { message: 'Bearish engulfing candle (sell-side pattern)' };
      }
      return null;
    }
    case 'pattern_hammer': {
      if (!isHammer(curr)) return null;
      if (bars.length < 4) return null;
      const c0 = Number(bars[bars.length - 4].close);
      const c1 = Number(bars[bars.length - 3].close);
      const c2 = Number(bars[bars.length - 2].close);
      if (![c0, c1, c2].every(Number.isFinite)) return null;
      if (!(c2 < c1 || c1 < c0)) return null;
      return { message: 'Hammer after short-term dip (buy bias pattern)' };
    }
    case 'pattern_shooting_star': {
      if (!isShootingStar(curr)) return null;
      if (bars.length < 4) return null;
      const c0 = Number(bars[bars.length - 4].close);
      const c1 = Number(bars[bars.length - 3].close);
      const c2 = Number(bars[bars.length - 2].close);
      if (![c0, c1, c2].every(Number.isFinite)) return null;
      if (!(c2 > c1 || c1 > c0)) return null;
      return { message: 'Shooting star after short-term rise (sell bias pattern)' };
    }
    case 'pattern_breakout_high': {
      const n = Math.round(Number(alert.threshold ?? 20));
      if (!Number.isFinite(n) || n < 3 || n > 500) return null;
      if (bars.length < n + 2) return null;
      let hi = -Infinity;
      for (let i = bars.length - n - 1; i <= bars.length - 2; i++) {
        const h = Number(bars[i].high);
        if (Number.isFinite(h)) hi = Math.max(hi, h);
      }
      if (!Number.isFinite(hi)) return null;
      if (pc <= hi && cc > hi) {
        return { message: `Close broke above ${n}-bar high ($${hi.toFixed(2)})` };
      }
      return null;
    }
    case 'pattern_breakdown_low': {
      const n = Math.round(Number(alert.threshold ?? 20));
      if (!Number.isFinite(n) || n < 3 || n > 500) return null;
      if (bars.length < n + 2) return null;
      let lo = Infinity;
      for (let i = bars.length - n - 1; i <= bars.length - 2; i++) {
        const low = Number(bars[i].low);
        if (Number.isFinite(low)) lo = Math.min(lo, low);
      }
      if (!Number.isFinite(lo)) return null;
      if (pc >= lo && cc < lo) {
        return { message: `Close broke below ${n}-bar low ($${lo.toFixed(2)})` };
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * @returns { { alert: object, message: string }[] }
 */
export function evaluateAllChartAlerts(alerts, bars, symbol) {
  if (!symbol || !Array.isArray(alerts) || !Array.isArray(bars)) return [];
  const out = [];
  for (const alert of alerts) {
    if (!alert.enabled || alert.symbol !== symbol) continue;
    const hit = evaluateChartAlert(alert, bars);
    if (hit) out.push({ alert, message: hit.message });
  }
  return out;
}
