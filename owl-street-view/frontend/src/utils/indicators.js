/** Map API bar to unix seconds for Lightweight Charts. */
export function barTimeSeconds(bar) {
  return Math.floor(new Date(bar.time).getTime() / 1000);
}

export function seriesSMA(bars, period) {
  if (bars.length < period) return [];
  const res = [];
  for (let i = period - 1; i < bars.length; i++) {
    let s = 0;
    for (let j = 0; j < period; j++) s += bars[i - j].close;
    res.push({ time: barTimeSeconds(bars[i]), value: s / period });
  }
  return res;
}

export function seriesEMA(bars, period) {
  if (bars.length < period) return [];
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) ema += bars[i].close;
  ema /= period;
  const res = [{ time: barTimeSeconds(bars[period - 1]), value: ema }];
  for (let i = period; i < bars.length; i++) {
    ema = bars[i].close * k + ema * (1 - k);
    res.push({ time: barTimeSeconds(bars[i]), value: ema });
  }
  return res;
}

export function seriesWMA(bars, period) {
  if (bars.length < period) return [];
  const res = [];
  const weightSum = (period * (period + 1)) / 2;
  for (let i = period - 1; i < bars.length; i++) {
    let weighted = 0;
    for (let j = 0; j < period; j++) {
      const weight = period - j;
      weighted += Number(bars[i - j].close) * weight;
    }
    res.push({ time: barTimeSeconds(bars[i]), value: weighted / weightSum });
  }
  return res;
}

export function seriesBollinger(bars, period, mult) {
  const middle = seriesSMA(bars, period);
  const upper = [];
  const lower = [];
  for (let idx = 0; idx < middle.length; idx++) {
    const i = idx + period - 1;
    const m = middle[idx].value;
    let sum = 0;
    for (let j = 0; j < period; j++) {
      const c = bars[i - j].close;
      sum += (c - m) ** 2;
    }
    const std = Math.sqrt(sum / period);
    const t = middle[idx].time;
    upper.push({ time: t, value: m + mult * std });
    lower.push({ time: t, value: m - mult * std });
  }
  return { upper, lower, middle };
}

export function seriesDonchian(bars, period) {
  if (bars.length < period) return { upper: [], lower: [], middle: [] };
  const upper = [];
  const lower = [];
  const middle = [];
  for (let i = period - 1; i < bars.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = 0; j < period; j++) {
      hi = Math.max(hi, Number(bars[i - j].high));
      lo = Math.min(lo, Number(bars[i - j].low));
    }
    const t = barTimeSeconds(bars[i]);
    upper.push({ time: t, value: hi });
    lower.push({ time: t, value: lo });
    middle.push({ time: t, value: (hi + lo) / 2 });
  }
  return { upper, lower, middle };
}

export function seriesRSI(bars, period) {
  if (bars.length <= period) return [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = bars[i].close - bars[i - 1].close;
    if (ch >= 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;
  const res = [];
  const pushRsi = (i) => {
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    res.push({ time: barTimeSeconds(bars[i]), value: 100 - 100 / (1 + rs) });
  };
  pushRsi(period);
  for (let i = period + 1; i < bars.length; i++) {
    const ch = bars[i].close - bars[i - 1].close;
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    pushRsi(i);
  }
  return res;
}

export function seriesVWAP(bars) {
  let pv = 0;
  let vol = 0;
  let sessionKey = '';
  const res = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const h = Number(b.high);
    const l = Number(b.low);
    const c = Number(b.close);
    const vRaw = Number(b.volume);
    if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;

    // Session VWAP: reset each UTC day boundary for intraday bars.
    const dt = new Date(b.time);
    const key = `${dt.getUTCFullYear()}-${dt.getUTCMonth()}-${dt.getUTCDate()}`;
    if (key !== sessionKey) {
      sessionKey = key;
      pv = 0;
      vol = 0;
    }

    const v = Number.isFinite(vRaw) && vRaw > 0 ? vRaw : 0;
    const tp = (h + l + c) / 3;
    pv += tp * v;
    vol += v;
    if (vol > 0) res.push({ time: barTimeSeconds(b), value: pv / vol });
  }
  return res;
}

export function seriesATR(bars, period = 14) {
  if (bars.length <= period) return [];
  const tr = [];
  for (let i = 1; i < bars.length; i++) {
    const h = Number(bars[i].high);
    const l = Number(bars[i].low);
    const prevC = Number(bars[i - 1].close);
    tr.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)));
  }
  let atr = 0;
  for (let i = 0; i < period; i++) atr += tr[i];
  atr /= period;
  const out = [{ time: barTimeSeconds(bars[period]), value: atr }];
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    out.push({ time: barTimeSeconds(bars[i + 1]), value: atr });
  }
  return out;
}

/** MACD line, signal, histogram aligned to ema26 warm-up. */
export function seriesMACD(bars, fast, slow, signalPeriod) {
  const emaF = seriesEMA(bars, fast);
  const emaS = seriesEMA(bars, slow);
  if (!emaF.length || !emaS.length) return { macd: [], signal: [], histogram: [] };
  const mapS = new Map(emaS.map((x) => [x.time, x.value]));
  const macdRaw = [];
  for (const p of emaF) {
    const s = mapS.get(p.time);
    if (s !== undefined) macdRaw.push({ time: p.time, value: p.value - s });
  }
  if (macdRaw.length < signalPeriod) return { macd: [], signal: [], histogram: [] };

  const fakeBars = macdRaw.map((m) => ({
    time: new Date(m.time * 1000).toISOString(),
    close: m.value,
    high: m.value,
    low: m.value,
    open: m.value,
    volume: 0,
  }));
  const signalEma = seriesEMA(fakeBars, signalPeriod);
  const mapSig = new Map(signalEma.map((x) => [x.time, x.value]));
  const macd = [];
  const signal = [];
  const histogram = [];
  for (const m of macdRaw) {
    const sig = mapSig.get(m.time);
    if (sig === undefined) continue;
    macd.push({ time: m.time, value: m.value });
    signal.push({ time: m.time, value: sig });
    histogram.push({
      time: m.time,
      value: m.value - sig,
      color: m.value >= sig ? 'rgba(63, 185, 80, 0.45)' : 'rgba(248, 81, 73, 0.45)',
    });
  }
  return { macd, signal, histogram };
}

/**
 * Lightweight Charts markers for heuristic buy/sell cues from MACD histogram crossing zero.
 * Buy: previous histogram ≤ 0 and current > 0. Sell: previous ≥ 0 and current < 0.
 * Not financial advice — display-only overlay.
 */
export function chartMacdHistogramSignalMarkers(bars, options = {}) {
  const minBarGap = options.minBarGap ?? 5;
  const buyColor = options.buyColor ?? '#3fb950';
  const sellColor = options.sellColor ?? '#f85149';
  const { histogram } = seriesMACD(bars, 12, 26, 9);
  if (histogram.length < 2) return [];

  const timeToIndex = new Map();
  for (let i = 0; i < bars.length; i++) {
    timeToIndex.set(barTimeSeconds(bars[i]), i);
  }

  const markers = [];
  let lastSignalBarIdx = -Infinity;
  for (let i = 1; i < histogram.length; i++) {
    const prev = histogram[i - 1].value;
    const curr = histogram[i].value;
    const t = histogram[i].time;
    const barIdx = timeToIndex.get(t);
    if (barIdx === undefined) continue;

    let buy = false;
    let sell = false;
    if (prev <= 0 && curr > 0) buy = true;
    else if (prev >= 0 && curr < 0) sell = true;
    if (!buy && !sell) continue;
    if (barIdx - lastSignalBarIdx < minBarGap) continue;
    lastSignalBarIdx = barIdx;

    markers.push({
      time: t,
      position: buy ? 'belowBar' : 'aboveBar',
      color: buy ? buyColor : sellColor,
      shape: buy ? 'arrowUp' : 'arrowDown',
    });
  }
  return markers;
}
