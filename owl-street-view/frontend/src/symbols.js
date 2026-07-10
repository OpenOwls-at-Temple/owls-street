/** Default tickers used by the watchlist and screener “Watchlist” universe. */
export const DEFAULT_WATCHLIST_SYMBOLS = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'SPY', 'QQQ'];

/** Major index / broad-market ETFs for screener “Index” scope. */
export const INDEX_ETF_SYMBOLS = [
  'SPY', 'QQQ', 'DIA', 'IWM', 'VTI', 'VOO', 'VEA', 'VWO', 'EFA', 'EEM',
  'XLF', 'XLE', 'XLK', 'XLV', 'XLI', 'XLY', 'XLP', 'XLB', 'XLRE', 'XLU', 'XLC',
];

/**
 * Post-filter buckets for screener “Index” column (symbol must be in set).
 * Keys match `INDEX_TAG_OPTIONS` `value` (except '' and legacy `major_etfs`).
 */
export const INDEX_SCREENER_SETS = {
  major_etfs: INDEX_ETF_SYMBOLS,
  sp500_etfs: ['SPY', 'VOO', 'IVV', 'SPLG', 'RSP', 'SCHX', 'ITOT', 'DGRO', 'NOBL'],
  nasdaq100_etfs: ['QQQ', 'QQQM'],
  total_market_etfs: ['VTI', 'ITOT', 'SCHB', 'VV', 'IXUS', 'ACWI'],
  sector_spdrs: ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLB', 'XLRE', 'XLU', 'XLC'],
  dow_etfs: ['DIA'],
  russell_etfs: ['IWM', 'VTWO', 'IWN', 'IWO', 'IWP'],
};

/** Standard OCC option symbol (equity + index). */
export function isOptionSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') return false;
  return /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(symbol.trim().toUpperCase());
}
