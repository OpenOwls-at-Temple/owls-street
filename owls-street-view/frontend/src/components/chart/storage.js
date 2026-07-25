const DRAWINGS_STORAGE_PREFIX = 'alpaca-tv-drawings:';
export const CHART_ALERTS_STORAGE_KEY = 'alpaca-tv-chart-alerts';

export function loadDrawingsForSymbol(symbol) {
  if (!symbol) return [];
  try {
    const raw = localStorage.getItem(DRAWINGS_STORAGE_PREFIX + symbol);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistDrawings(symbol, list) {
  if (!symbol) return;
  try {
    localStorage.setItem(DRAWINGS_STORAGE_PREFIX + symbol, JSON.stringify(list));
  } catch (_) {}
}

export function newDrawingId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `d-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function loadAllChartAlerts() {
  try {
    const raw = localStorage.getItem(CHART_ALERTS_STORAGE_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw);
    if (!Array.isArray(p)) return [];
    return p.filter(
      (a) =>
        a
        && typeof a.id === 'string'
        && typeof a.symbol === 'string'
        && typeof a.type === 'string'
        && typeof a.enabled === 'boolean',
    );
  } catch {
    return [];
  }
}

export function persistAllChartAlerts(list) {
  try {
    localStorage.setItem(CHART_ALERTS_STORAGE_KEY, JSON.stringify(list));
  } catch (_) {}
}

export function newChartAlertId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `al-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
