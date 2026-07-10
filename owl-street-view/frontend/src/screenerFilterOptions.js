/**
 * All screener UI choices are defined here as dropdown option lists (no hardcoded JSX options).
 * Wired filters map to Alpaca snapshot scan; fundamentals use FMP when ``FMP_API_KEY`` is set on the backend.
 * TradingView-style filter categories: `FILTER_CATEGORIES` + `FILTER_LABEL_BY_KEY` power the Filters menu.
 */

/** @typedef {{ value: string, label: string, disabled?: boolean }} ScreenerOption */

/** @type {ScreenerOption[]} */
export const SCREENER_PRESET_OPTIONS = [
  { value: 'default', label: 'Stock Screener' },
  { value: 'gainers', label: 'Top gainers' },
  { value: 'losers', label: 'Top losers' },
  { value: 'high_volume', label: 'High volume' },
];

/** @type {ScreenerOption[]} */
export const MARKET_UNIVERSE_OPTIONS = [
  { value: 'tradable', label: 'All US stocks' },
  { value: 'liquid', label: 'Liquid + popular ETFs' },
  { value: 'watchlist', label: 'Watchlist' },
  { value: 'index', label: 'Index / benchmark ETFs' },
];

/** @type {ScreenerOption[]} */
export const REGION_OPTIONS = [
  { value: '', label: 'Any region' },
  { value: 'us', label: 'United States' },
  { value: 'ca', label: 'Canada', disabled: true },
  { value: 'uk', label: 'United Kingdom', disabled: true },
  { value: 'eu', label: 'Europe', disabled: true },
  { value: 'asia', label: 'Asia', disabled: true },
];

/** @type {ScreenerOption[]} */
export const WATCHLIST_TAG_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'in_watchlist', label: 'In watchlist only' },
];

/** @type {ScreenerOption[]} */
export const INDEX_TAG_OPTIONS = [
  { value: '', label: 'Any index / ETF group' },
  { value: 'major_etfs', label: 'Major index & sector ETFs' },
  { value: 'sp500_etfs', label: 'S&P 500 ETFs (SPY, VOO, …)' },
  { value: 'nasdaq100_etfs', label: 'Nasdaq-100 (QQQ, QQQM)' },
  { value: 'total_market_etfs', label: 'Total market (VTI, ITOT, …)' },
  { value: 'sector_spdrs', label: 'Sector SPDRs (XLK, XLF, …)' },
  { value: 'dow_etfs', label: 'Dow Jones (DIA)' },
  { value: 'russell_etfs', label: 'Russell 2000 style (IWM, …)' },
];

/** Last price (regular snapshot “last”). */
/** @type {ScreenerOption[]} */
export const PRICE_OPTIONS = [
  { value: '', label: 'Any price' },
  { value: 'under_1', label: 'Under $1' },
  { value: '1_5', label: '$1 – $5' },
  { value: 'under_5', label: 'Under $5' },
  { value: '5_20', label: '$5 – $20' },
  { value: '20_50', label: '$20 – $50' },
  { value: '20_100', label: '$20 – $100' },
  { value: '50_100', label: '$50 – $100' },
  { value: '100_500', label: '$100 – $500' },
  { value: '500_1000', label: '$500 – $1,000' },
  { value: '1000_5000', label: '$1,000 – $5,000' },
  { value: 'over_500', label: 'Over $500' },
  { value: 'over_5000', label: 'Over $5,000' },
  { value: 'custom', label: 'Custom range…' },
];

/** Session / daily open price (from daily bar when available). */
/** @type {ScreenerOption[]} */
export const OPEN_PRICE_OPTIONS = [
  { value: '', label: 'Any open' },
  { value: 'o_under_5', label: 'Open under $5' },
  { value: 'o_5_20', label: 'Open $5 – $20' },
  { value: 'o_20_100', label: 'Open $20 – $100' },
  { value: 'o_100_500', label: 'Open $100 – $500' },
  { value: 'o_over_500', label: 'Open over $500' },
  { value: 'o_custom', label: 'Custom open range…' },
];

/** @type {ScreenerOption[]} */
export const CHANGE_PCT_OPTIONS = [
  { value: '', label: 'Any % change' },
  { value: 'gt0', label: '> 0%' },
  { value: 'gt0_5', label: '> 0.5%' },
  { value: 'gt1', label: '> 1%' },
  { value: 'gt2', label: '> 2%' },
  { value: 'gt3', label: '> 3%' },
  { value: 'gt5', label: '> 5%' },
  { value: 'gt10', label: '> 10%' },
  { value: 'lt0', label: '< 0%' },
  { value: 'lt_m0_5', label: '< -0.5%' },
  { value: 'lt_m1', label: '< -1%' },
  { value: 'lt_m2', label: '< -2%' },
  { value: 'lt_m3', label: '< -3%' },
  { value: 'lt_m5', label: '< -5%' },
  { value: 'custom_chg', label: 'Custom % range…' },
];

/** @type {ScreenerOption[]} */
export const VOLUME_OPTIONS = [
  { value: '', label: 'Any volume' },
  { value: '50k', label: '> 50K' },
  { value: '100k', label: '> 100K' },
  { value: '250k', label: '> 250K' },
  { value: '500k', label: '> 500K' },
  { value: '1m', label: '> 1M' },
  { value: '2m', label: '> 2M' },
  { value: '5m', label: '> 5M' },
  { value: '10m', label: '> 10M' },
  { value: '50m', label: '> 50M' },
  { value: '100m', label: '> 100M' },
  { value: '250m', label: '> 250M' },
  { value: 'custom_vol', label: 'Custom minimum…' },
];

/** Estimated daily dollar turnover (last × daily volume); snapshot only. */
/** @type {ScreenerOption[]} */
export const DOLLAR_VOLUME_OPTIONS = [
  { value: '', label: 'Any turnover' },
  { value: 'dv_1m', label: '> $1M' },
  { value: 'dv_5m', label: '> $5M' },
  { value: 'dv_10m', label: '> $10M' },
  { value: 'dv_25m', label: '> $25M' },
  { value: 'dv_50m', label: '> $50M' },
  { value: 'dv_100m', label: '> $100M' },
  { value: 'dv_250m', label: '> $250M' },
  { value: 'dv_500m', label: '> $500M' },
  { value: 'dv_1b', label: '> $1B' },
  { value: 'dv_5b', label: '> $5B' },
  { value: 'custom_dv', label: 'Custom minimum ($)…' },
];

/** (High − low) / prev. close × 100 for the session daily bar. */
/** @type {ScreenerOption[]} */
export const DAY_RANGE_PCT_OPTIONS = [
  { value: '', label: 'Any daily range %' },
  { value: 'rng_0_5', label: '> 0.5%' },
  { value: 'rng_1', label: '> 1%' },
  { value: 'rng_1_5', label: '> 1.5%' },
  { value: 'rng_2', label: '> 2%' },
  { value: 'rng_3', label: '> 3%' },
  { value: 'rng_5', label: '> 5%' },
  { value: 'rng_8', label: '> 8%' },
  { value: 'rng_10', label: '> 10%' },
  { value: 'rng_15', label: '> 15%' },
  { value: 'custom_range', label: 'Custom minimum %…' },
];

/** @type {ScreenerOption[]} */
export const EXCHANGE_OPTIONS = [
  { value: '', label: 'Any exchange' },
  { value: 'NASDAQ', label: 'NASDAQ' },
  { value: 'NYSE', label: 'NYSE' },
  { value: 'AMEX', label: 'NYSE American' },
  { value: 'ARCA', label: 'NYSE Arca' },
  { value: 'BATS', label: 'Cboe BZX' },
];

/** Market cap (USD) — requires ``FMP_API_KEY`` on the server. */
/** @type {ScreenerOption[]} */
export const MARKET_CAP_OPTIONS = [
  { value: '', label: 'Any market cap' },
  { value: 'mc_nano', label: 'Nano (< $50M)' },
  { value: 'mc_micro', label: 'Micro (< $300M)' },
  { value: 'mc_small', label: 'Small ($300M – $2B)' },
  { value: 'mc_mid', label: 'Mid ($2B – $10B)' },
  { value: 'mc_large', label: 'Large ($10B – $200B)' },
  { value: 'mc_mega', label: 'Mega (> $200B)' },
  { value: 'mc_lt1b', label: 'Below $1B' },
  { value: 'mc_1b_10b', label: '$1B – $10B' },
  { value: 'mc_10b_50b', label: '$10B – $50B' },
  { value: 'mc_50b_200b', label: '$50B – $200B' },
  { value: 'mc_gt200b', label: 'Above $200B' },
];

/** @type {ScreenerOption[]} */
export const PE_RATIO_OPTIONS = [
  { value: '', label: 'Any P/E' },
  { value: 'pe_lt0', label: 'P/E < 0 (negative earnings)' },
  { value: 'pe_0_5', label: '0 – 5' },
  { value: 'pe_5_10', label: '5 – 10' },
  { value: 'pe_10_15', label: '10 – 15' },
  { value: 'pe_15_25', label: '15 – 25' },
  { value: 'pe_25_40', label: '25 – 40' },
  { value: 'pe_gt40', label: '> 40' },
  { value: 'pe_lt15', label: 'P/E < 15' },
  { value: 'pe_gt50', label: 'P/E > 50' },
];

/** @type {ScreenerOption[]} */
export const PEG_OPTIONS = [
  { value: '', label: 'Any PEG' },
  { value: 'peg_lt1', label: 'PEG < 1' },
  { value: 'peg_1_2', label: '1 – 2' },
  { value: 'peg_2_3', label: '2 – 3' },
  { value: 'peg_gt3', label: '> 3' },
];

/** @type {ScreenerOption[]} */
export const EPS_GROWTH_OPTIONS = [
  { value: '', label: 'Any EPS growth' },
  { value: 'eps_gt25', label: '> 25% YoY' },
  { value: 'eps_gt15', label: '> 15% YoY' },
  { value: 'eps_gt5', label: '> 5% YoY' },
  { value: 'eps_gt0', label: '> 0% YoY' },
  { value: 'eps_lt0', label: '< 0% YoY' },
];

/** @type {ScreenerOption[]} */
export const REVENUE_GROWTH_OPTIONS = [
  { value: '', label: 'Any revenue growth' },
  { value: 'rev_gt30', label: '> 30% YoY' },
  { value: 'rev_gt20', label: '> 20% YoY' },
  { value: 'rev_gt10', label: '> 10% YoY' },
  { value: 'rev_gt5', label: '> 5% YoY' },
  { value: 'rev_lt0', label: 'Negative growth' },
];

/** @type {ScreenerOption[]} */
export const ROE_OPTIONS = [
  { value: '', label: 'Any ROE' },
  { value: 'roe_gt30', label: '> 30%' },
  { value: 'roe_gt20', label: '> 20%' },
  { value: 'roe_gt15', label: '> 15%' },
  { value: 'roe_gt10', label: '> 10%' },
  { value: 'roe_gt5', label: '> 5%' },
  { value: 'roe_lt0', label: '< 0%' },
];

/** @type {ScreenerOption[]} */
export const DIV_YIELD_OPTIONS = [
  { value: '', label: 'Any dividend yield' },
  { value: 'div_gt8', label: '> 8%' },
  { value: 'div_gt5', label: '> 5%' },
  { value: 'div_gt3', label: '> 3%' },
  { value: 'div_gt2', label: '> 2%' },
  { value: 'div_gt1', label: '> 1%' },
  { value: 'div_gt0', label: '> 0%' },
  { value: 'div_0', label: 'No / negligible dividend' },
];

/** @type {ScreenerOption[]} */
export const BETA_OPTIONS = [
  { value: '', label: 'Any beta' },
  { value: 'b_lt0', label: 'Beta < 0' },
  { value: 'b_0_0_5', label: '0 – 0.5' },
  { value: 'b_0_5_1', label: '0.5 – 1' },
  { value: 'b_1_1_5', label: '1 – 1.5' },
  { value: 'b_1_5_2', label: '1.5 – 2' },
  { value: 'b_gt2', label: '> 2' },
];

/** Values must match FMP ``profile`` sector strings (case-insensitive match on server). */
/** @type {ScreenerOption[]} */
export const SECTOR_OPTIONS = [
  { value: '', label: 'Any sector' },
  { value: 'Basic Materials', label: 'Basic materials' },
  { value: 'Communication Services', label: 'Communication services' },
  { value: 'Consumer Cyclical', label: 'Consumer cyclical' },
  { value: 'Consumer Defensive', label: 'Consumer defensive' },
  { value: 'Energy', label: 'Energy' },
  { value: 'Financial Services', label: 'Financial services' },
  { value: 'Healthcare', label: 'Healthcare' },
  { value: 'Industrials', label: 'Industrials' },
  { value: 'Real Estate', label: 'Real estate' },
  { value: 'Technology', label: 'Technology' },
  { value: 'Utilities', label: 'Utilities' },
];

/** @type {ScreenerOption[]} */
export const ANALYST_RATING_OPTIONS = [
  { value: '', label: 'Any rating' },
  { value: 'ar_sb', label: 'Strong buy', disabled: true },
  { value: 'ar_buy', label: 'Buy', disabled: true },
  { value: 'ar_hold', label: 'Hold', disabled: true },
  { value: 'ar_sell', label: 'Sell', disabled: true },
  { value: 'ar_ss', label: 'Strong sell', disabled: true },
];

/** @type {ScreenerOption[]} */
export const EARNINGS_DATE_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'ed_today', label: 'Today', disabled: true },
  { value: 'ed_yest', label: 'Yesterday', disabled: true },
  { value: 'ed_tom', label: 'Tomorrow', disabled: true },
  { value: 'ed_this_week', label: 'This week', disabled: true },
  { value: 'ed_next_week', label: 'Next week', disabled: true },
  { value: 'ed_this_month', label: 'This month', disabled: true },
  { value: 'ed_next_month', label: 'Next month', disabled: true },
  { value: 'ed_past_7', label: 'Past 7 days', disabled: true },
  { value: 'ed_next_7', label: 'Next 7 days', disabled: true },
  { value: 'ed_past_30', label: 'Past 30 days', disabled: true },
  { value: 'ed_next_30', label: 'Next 30 days', disabled: true },
];

/** @type {ScreenerOption[]} */
export const MORE_ACTION_OPTIONS = [
  { value: '', label: 'More…' },
  { value: 'export', label: 'Export CSV', disabled: true },
  { value: 'save', label: 'Save screen', disabled: true },
];

/** @type {ScreenerOption[]} */
export const COLUMN_PRESET_OPTIONS = [
  { value: 'overview', label: 'Overview' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'extended', label: 'Extended' },
];

/** @type {ScreenerOption[]} */
export const SORT_FIELD_OPTIONS = [
  { value: 'change_pct', label: '% Change' },
  { value: 'last', label: 'Last' },
  { value: 'volume', label: 'Volume' },
  { value: 'symbol', label: 'Symbol' },
  { value: 'name', label: 'Name' },
  { value: 'market_cap', label: 'Market cap (FMP)' },
  { value: 'pe', label: 'P/E (FMP)' },
  { value: 'beta', label: 'Beta (FMP)' },
];

/** @type {ScreenerOption[]} */
export const SORT_DIR_OPTIONS = [
  { value: 'desc', label: 'Descending' },
  { value: 'asc', label: 'Ascending' },
];

/** @type {ScreenerOption[]} */
export const MAX_SCAN_OPTIONS = [100, 200, 300, 500, 750, 1000, 1500].map((n) => ({
  value: String(n),
  label: `${n} symbols`,
}));

/** @type {ScreenerOption[]} */
export const LIMIT_OPTIONS = [25, 50, 100, 200, 350, 500].map((n) => ({
  value: String(n),
  label: `${n} rows`,
}));

/**
 * Row metadata: each entry is one labeled dropdown; `options` is the full list for that `<select>`.
 * @type {{ key: string, label: string, options: ScreenerOption[] }[][]}
 */
export const FILTER_DROPDOWN_ROWS = [
  [
    { key: 'region', label: 'Region', options: REGION_OPTIONS },
    { key: 'watchlist_tag', label: 'Watchlist', options: WATCHLIST_TAG_OPTIONS },
    { key: 'index_tag', label: 'Index / ETF', options: INDEX_TAG_OPTIONS },
    { key: 'price', label: 'Last price', options: PRICE_OPTIONS },
    { key: 'open_band', label: 'Open', options: OPEN_PRICE_OPTIONS },
    { key: 'change_pct', label: 'Change %', options: CHANGE_PCT_OPTIONS },
    { key: 'dollar_vol', label: 'Dollar volume', options: DOLLAR_VOLUME_OPTIONS },
    { key: 'volume', label: 'Share volume', options: VOLUME_OPTIONS },
  ],
  [
    { key: 'pe', label: 'P/E ratio', options: PE_RATIO_OPTIONS },
    { key: 'eps', label: 'EPS growth', options: EPS_GROWTH_OPTIONS },
    { key: 'div', label: 'Dividend yield', options: DIV_YIELD_OPTIONS },
    { key: 'sector', label: 'Sector', options: SECTOR_OPTIONS },
    { key: 'analyst', label: 'Analyst rating', options: ANALYST_RATING_OPTIONS },
    { key: 'day_range', label: 'Daily range %', options: DAY_RANGE_PCT_OPTIONS },
    { key: 'rev', label: 'Revenue growth', options: REVENUE_GROWTH_OPTIONS },
    { key: 'market_cap', label: 'Market cap', options: MARKET_CAP_OPTIONS },
  ],
  [
    { key: 'peg', label: 'PEG', options: PEG_OPTIONS },
    { key: 'roe', label: 'ROE', options: ROE_OPTIONS },
    { key: 'beta', label: 'Beta', options: BETA_OPTIONS },
    { key: 'earn_recent', label: 'Recent earnings', options: EARNINGS_DATE_OPTIONS },
    { key: 'earn_up', label: 'Upcoming earnings', options: EARNINGS_DATE_OPTIONS },
    { key: 'exchange', label: 'Exchange', options: EXCHANGE_OPTIONS },
  ],
];

/** Human labels for filter keys (same as row labels); used by the Filters picker. */
export const FILTER_LABEL_BY_KEY = Object.fromEntries(FILTER_DROPDOWN_ROWS.flat().map((f) => [f.key, f.label]));

/**
 * TradingView-style filter menu groups. Each screener `key` appears exactly once.
 * `filterKeys.length` is the count shown next to the category (filters available in this app).
 */
export const FILTER_CATEGORIES = [
  { id: 'security_info', label: 'Security info', filterKeys: ['region', 'watchlist_tag', 'index_tag', 'sector', 'exchange', 'analyst'] },
  { id: 'market_data', label: 'Market data', filterKeys: ['price', 'open_band', 'change_pct', 'volume', 'dollar_vol', 'day_range'] },
  { id: 'technicals', label: 'Technicals', filterKeys: ['beta'] },
  { id: 'financials', label: 'Financials', filterKeys: ['market_cap', 'earn_recent', 'earn_up'] },
  { id: 'valuation', label: 'Valuation', filterKeys: ['pe', 'peg'] },
  { id: 'growth', label: 'Growth', filterKeys: ['eps', 'rev'] },
  { id: 'margins', label: 'Margins', filterKeys: ['roe'] },
  { id: 'dividends', label: 'Dividends', filterKeys: ['div'] },
];

/** Build initial / reset state for every filter `<select>`. */
export function buildEmptyFilterSelects() {
  const o = {};
  FILTER_DROPDOWN_ROWS.flat().forEach((f) => {
    o[f.key] = '';
  });
  return o;
}
