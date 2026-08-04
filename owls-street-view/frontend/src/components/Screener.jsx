import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runScreener } from '../api';
import {
  buildEmptyFilterSelects,
  COLUMN_PRESET_OPTIONS,
  FILTER_CATEGORIES,
  FILTER_DROPDOWN_ROWS,
  FILTER_LABEL_BY_KEY,
  LIMIT_OPTIONS,
  MARKET_UNIVERSE_OPTIONS,
  MAX_SCAN_OPTIONS,
  MORE_ACTION_OPTIONS,
  SCREENER_PRESET_OPTIONS,
  SORT_DIR_OPTIONS,
  SORT_FIELD_OPTIONS,
} from '../screenerFilterOptions';
import { buildFundamentalPayload } from '../screenerFundamentalPayload';
import { DEFAULT_WATCHLIST_SYMBOLS, INDEX_ETF_SYMBOLS, INDEX_SCREENER_SETS } from '../symbols';

const s = {
  root: { display: 'flex', flexDirection: 'column', gap: 0, minHeight: 320 },
  rootMax: {
    position: 'fixed',
    inset: 0,
    zIndex: 100,
    background: 'var(--bg-app)',
    overflow: 'auto',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  shell: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    boxShadow: 'var(--shadow-card)',
    overflow: 'visible',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '12px 14px',
    borderBottom: '1px solid var(--border)',
    flexWrap: 'wrap',
  },
  subBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '10px 14px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    flexWrap: 'wrap',
  },
  selectTitle: {
    appearance: 'none',
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    padding: '8px 32px 8px 12px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    minWidth: 180,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M3 4.5L6 8l3-3.5'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 10px center',
  },
  selectSm: {
    appearance: 'none',
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    padding: '6px 28px 6px 10px',
    fontSize: 12,
    cursor: 'pointer',
    width: '100%',
    boxSizing: 'border-box',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M3 4.5L6 8l3-3.5'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 8px center',
  },
  iconBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  iconRow: { display: 'flex', alignItems: 'center', gap: 6 },
  filterGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(152px, 1fr))',
    gap: '10px 12px',
    padding: '12px 14px',
    borderBottom: '1px solid var(--border-subtle)',
    alignItems: 'end',
  },
  filterCell: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  filterLabel: { fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 },
  customRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: 10,
    padding: '0 14px 12px',
    borderBottom: '1px solid var(--border-subtle)',
  },
  bottomBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    padding: '10px 14px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
  },
  viewSeg: { display: 'flex', borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' },
  viewSegBtn: (on) => ({
    padding: '8px 12px',
    border: 'none',
    cursor: 'pointer',
    background: on ? 'var(--bg-input)' : 'transparent',
    color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
  }),
  input: {
    width: '100%',
    boxSizing: 'border-box',
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text-primary)',
    padding: '8px 10px',
    fontSize: 13,
    outline: 'none',
  },
  label: { fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' },
  rowActions: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '0 14px 14px' },
  btn: {
    background: 'var(--accent)',
    color: 'var(--accent-contrast)',
    border: 'none',
    borderRadius: 6,
    padding: '10px 18px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: 'var(--shadow-soft)',
  },
  btnGhost: {
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '8px 14px',
    fontSize: 12,
    cursor: 'pointer',
  },
  err: { fontSize: 13, color: 'var(--danger)', padding: '0 14px 12px' },
  meta: { fontSize: 12, color: 'var(--text-secondary)' },
  tableWrap: {
    overflow: 'auto',
    maxHeight: 'min(62vh, 560px)',
    borderTop: '1px solid var(--border-subtle)',
    background: 'var(--bg-surface)',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    position: 'sticky',
    top: 0,
    background: 'var(--bg-elevated)',
    color: 'var(--text-secondary)',
    textAlign: 'left',
    padding: '10px 12px',
    borderBottom: '1px solid var(--border)',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    zIndex: 1,
  },
  td: {
    padding: '8px 12px',
    borderBottom: '1px solid var(--border-subtle)',
    color: 'var(--text-primary)',
  },
  sym: { fontWeight: 700, color: 'var(--accent)', cursor: 'pointer' },
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  pos: { color: 'var(--success)' },
  neg: { color: 'var(--danger)' },
  settingsPanel: {
    position: 'absolute',
    right: 14,
    top: '100%',
    marginTop: 6,
    minWidth: 280,
    padding: 14,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    boxShadow: 'var(--shadow-card)',
    zIndex: 30,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '10px 12px',
  },
  settingsFull: { gridColumn: '1 / -1' },
  filtersMenuAnchor: { position: 'relative', minWidth: 0, width: '100%' },
  filtersTrigger: {
    appearance: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    width: '100%',
    boxSizing: 'border-box',
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    padding: '6px 10px',
    fontSize: 12,
    cursor: 'pointer',
    textAlign: 'left',
  },
  filtersPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '100%',
    marginTop: 6,
    minWidth: 280,
    maxWidth: 320,
    maxHeight: 'min(72vh, 440px)',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    boxShadow: 'var(--shadow-card)',
    zIndex: 40,
    overflow: 'hidden',
  },
  filtersPanelTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--text-primary)',
    padding: '12px 14px 10px',
    borderBottom: '1px solid var(--border-subtle)',
  },
  filtersSearchInput: {
    margin: '10px 12px 8px',
    width: 'calc(100% - 24px)',
    boxSizing: 'border-box',
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    padding: '8px 10px',
    fontSize: 13,
    outline: 'none',
  },
  filtersScroll: { overflowY: 'auto', flex: 1, padding: '4px 8px 12px' },
  filtersBackBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    margin: '6px 8px 4px',
    padding: '6px 8px',
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left',
  },
  filterCatRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid transparent',
    borderRadius: 8,
    padding: '10px 10px',
    background: 'transparent',
    cursor: 'pointer',
    color: 'var(--text-primary)',
    fontSize: 13,
    textAlign: 'left',
  },
  filterCatRowFocus: { outline: 'none' },
  filterCatIcon: { width: 22, flexShrink: 0, display: 'flex', justifyContent: 'center', color: 'var(--text-secondary)' },
  filterCatCount: { marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 12, fontVariantNumeric: 'tabular-nums' },
  filterKeyRow: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid transparent',
    borderRadius: 8,
    padding: '10px 12px',
    background: 'transparent',
    cursor: 'pointer',
    color: 'var(--text-primary)',
    fontSize: 13,
    textAlign: 'left',
  },
  chartPlaceholder: {
    minHeight: 280,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
    fontSize: 14,
    padding: 32,
    textAlign: 'center',
    borderTop: '1px solid var(--border-subtle)',
  },
};

function applyPriceTier(setMinPrice, setMaxPrice, value) {
  setMinPrice('');
  setMaxPrice('');
  if (!value || value === 'custom') return;
  const map = {
    under_1: ['', '1'],
    '1_5': ['1', '5'],
    under_5: ['', '5'],
    '5_20': ['5', '20'],
    '20_50': ['20', '50'],
    '20_100': ['20', '100'],
    '50_100': ['50', '100'],
    '100_500': ['100', '500'],
    '500_1000': ['500', '1000'],
    '1000_5000': ['1000', '5000'],
    over_500: ['500', ''],
    over_5000: ['5000', ''],
  };
  const pair = map[value];
  if (pair) {
    setMinPrice(pair[0]);
    setMaxPrice(pair[1]);
  }
}

function applyOpenTier(setMinOpen, setMaxOpen, value) {
  setMinOpen('');
  setMaxOpen('');
  if (!value || value === 'o_custom') return;
  const map = {
    o_under_5: ['', '5'],
    o_5_20: ['5', '20'],
    o_20_100: ['20', '100'],
    o_100_500: ['100', '500'],
    o_over_500: ['500', ''],
  };
  const pair = map[value];
  if (pair) {
    setMinOpen(pair[0]);
    setMaxOpen(pair[1]);
  }
}

function applyChangeTier(setMinChg, setMaxChg, value) {
  setMinChg('');
  setMaxChg('');
  if (!value || value === 'custom_chg') return;
  const tiers = {
    gt0: ['0', ''],
    gt0_5: ['0.5', ''],
    gt1: ['1', ''],
    gt2: ['2', ''],
    gt3: ['3', ''],
    gt5: ['5', ''],
    gt10: ['10', ''],
    lt0: ['', '0'],
    lt_m0_5: ['', '-0.5'],
    lt_m1: ['', '-1'],
    lt_m2: ['', '-2'],
    lt_m3: ['', '-3'],
    lt_m5: ['', '-5'],
  };
  const p = tiers[value];
  if (p) {
    setMinChg(p[0]);
    setMaxChg(p[1]);
  }
}

function applyVolumeTier(setMinVol, value) {
  setMinVol('');
  if (!value || value === 'custom_vol') return;
  const map = {
    '50k': '50000',
    '100k': '100000',
    '250k': '250000',
    '500k': '500000',
    '1m': '1000000',
    '2m': '2000000',
    '5m': '5000000',
    '10m': '10000000',
    '50m': '50000000',
    '100m': '100000000',
    '250m': '250000000',
  };
  if (map[value]) setMinVol(map[value]);
}

function applyDollarVolTier(setMinDv, value) {
  setMinDv('');
  if (!value || value === 'custom_dv') return;
  const map = {
    dv_1m: 1e6,
    dv_5m: 5e6,
    dv_10m: 1e7,
    dv_25m: 2.5e7,
    dv_50m: 5e7,
    dv_100m: 1e8,
    dv_250m: 2.5e8,
    dv_500m: 5e8,
    dv_1b: 1e9,
    dv_5b: 5e9,
  };
  const n = map[value];
  if (n != null) setMinDv(String(Math.round(n)));
}

function applyDayRangeTier(setMinRng, value) {
  setMinRng('');
  if (!value || value === 'custom_range') return;
  const map = {
    rng_0_5: 0.5,
    rng_1: 1,
    rng_1_5: 1.5,
    rng_2: 2,
    rng_3: 3,
    rng_5: 5,
    rng_8: 8,
    rng_10: 10,
    rng_15: 15,
  };
  const n = map[value];
  if (n != null) setMinRng(String(n));
}

function IconMaximize() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

function IconMinimize() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 14h6v6M14 4h6v6M10 4L4 10M14 20l6-6" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M23 4v6h-6M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 3v18h18M7 16l4-4 4 4 6-7" />
    </svg>
  );
}

function IconBars() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M4 6h2v14H4V6zm5 4h2v10H9V10zm5-6h2v16h-2V4z" />
    </svg>
  );
}

/** Small icons for Filters menu categories (TradingView-style groups). */
function FilterCategoryIcon({ categoryId }) {
  const c = 'currentColor';
  const w = 18;
  const h = 18;
  switch (categoryId) {
    case 'security_info':
      return (
        <svg width={w} height={h} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.75" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 10v5M12 8h.01" strokeLinecap="round" />
        </svg>
      );
    case 'market_data':
      return (
        <svg width={w} height={h} viewBox="0 0 24 24" fill={c} stroke={c} strokeWidth="1.5" aria-hidden>
          <line x1="7" y1="5" x2="7" y2="19" strokeLinecap="round" />
          <rect x="5" y="9" width="4" height="6" fill={c} stroke="none" />
          <line x1="14" y1="7" x2="14" y2="19" strokeLinecap="round" />
          <rect x="12" y="11" width="4" height="5" fill={c} stroke="none" />
        </svg>
      );
    case 'technicals':
      return (
        <svg width={w} height={h} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.75" aria-hidden>
          <path d="M3 17l6-6 4 4 8-10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'financials':
      return (
        <svg width={w} height={h} viewBox="0 0 24 24" fill={c} aria-hidden>
          <path d="M4 19h4V9H4v10zm6 0h4V5h-4v14zm6 0h4v-8h-4v8z" opacity="0.9" />
        </svg>
      );
    case 'valuation':
      return (
        <svg width={w} height={h} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.75" aria-hidden>
          <path d="M12 12V3a9 9 0 019 9H12z" fill={c} fillOpacity="0.22" strokeLinejoin="round" />
        </svg>
      );
    case 'growth':
      return (
        <svg width={w} height={h} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.75" aria-hidden>
          <path d="M4 19h16M7 14l4-4 3 3 5-6M14 7h4v4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'margins':
      return (
        <svg width={w} height={h} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6" aria-hidden>
          <path d="M8 17c0 1.2 8 1.2 8 0V9c0-1.2-8-1.2-8 0v8z" />
          <path d="M6 13c0 1 10 1 10 0" strokeLinecap="round" />
          <path d="M9.5 6h5" strokeLinecap="round" />
        </svg>
      );
    case 'dividends':
      return (
        <svg width={w} height={h} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.75" aria-hidden>
          <path d="M12 5c-3 0-5 2-5 5 0 4 5 9 5 9s5-5 5-9c0-3-2-5-5-5z" />
          <path d="M12 9v6M9.5 12h5" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg width={w} height={h} viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="2" fill={c} />
        </svg>
      );
  }
}

function num(v, digits = 2) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function volFmt(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

export default function Screener({
  onPickSymbol,
  onGoToChart,
  onClose,
  watchlistSymbols = DEFAULT_WATCHLIST_SYMBOLS,
}) {
  const [screenerPreset, setScreenerPreset] = useState('default');
  const [marketScope, setMarketScope] = useState('tradable');
  const [maximized, setMaximized] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const [viewMode, setViewMode] = useState('table');
  const [columnPreset, setColumnPreset] = useState('overview');
  const [filterSelects, setFilterSelects] = useState(buildEmptyFilterSelects);

  const [maxScan, setMaxScan] = useState(300);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minChg, setMinChg] = useState('');
  const [maxChg, setMaxChg] = useState('');
  const [minVol, setMinVol] = useState('');
  const [minOpen, setMinOpen] = useState('');
  const [maxOpen, setMaxOpen] = useState('');
  const [minDollarVol, setMinDollarVol] = useState('');
  const [minRangePct, setMinRangePct] = useState('');
  const [exchange, setExchange] = useState('');
  const [sort, setSort] = useState('change_pct');
  const [sortDir, setSortDir] = useState('desc');
  const [limit, setLimit] = useState(200);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(null);
  const [rows, setRows] = useState([]);

  const shellRef = useRef(null);
  const filtersMenuRef = useRef(null);
  const [filtersPickerOpen, setFiltersPickerOpen] = useState(false);
  const [filtersPickerCategoryId, setFiltersPickerCategoryId] = useState(null);
  const [filtersPickerSearch, setFiltersPickerSearch] = useState('');

  useEffect(() => {
    function onDocClick(e) {
      if (!settingsOpen) return;
      const el = shellRef.current;
      if (el && !el.contains(e.target)) setSettingsOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [settingsOpen]);

  useEffect(() => {
    if (!filtersPickerOpen) return undefined;
    function onDown(e) {
      const wrap = filtersMenuRef.current;
      if (wrap && !wrap.contains(e.target)) {
        setFiltersPickerOpen(false);
        setFiltersPickerCategoryId(null);
        setFiltersPickerSearch('');
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [filtersPickerOpen]);

  useEffect(() => {
    if (!filtersPickerOpen) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') {
        if (filtersPickerCategoryId) setFiltersPickerCategoryId(null);
        else {
          setFiltersPickerOpen(false);
          setFiltersPickerSearch('');
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtersPickerOpen, filtersPickerCategoryId]);

  const filteredFilterCategories = useMemo(() => {
    const q = filtersPickerSearch.trim().toLowerCase();
    if (!q) return FILTER_CATEGORIES;
    return FILTER_CATEGORIES.filter(
      (cat) =>
        cat.label.toLowerCase().includes(q) ||
        cat.filterKeys.some((k) => (FILTER_LABEL_BY_KEY[k] || '').toLowerCase().includes(q)),
    );
  }, [filtersPickerSearch]);

  const activeFilterCategory = useMemo(
    () => FILTER_CATEGORIES.find((c) => c.id === filtersPickerCategoryId) || null,
    [filtersPickerCategoryId],
  );

  const filteredKeysInCategory = useMemo(() => {
    if (!activeFilterCategory) return [];
    const q = filtersPickerSearch.trim().toLowerCase();
    if (!q) return activeFilterCategory.filterKeys;
    return activeFilterCategory.filterKeys.filter(
      (k) =>
        (FILTER_LABEL_BY_KEY[k] || '').toLowerCase().includes(q) ||
        activeFilterCategory.label.toLowerCase().includes(q),
    );
  }, [activeFilterCategory, filtersPickerSearch]);

  const focusFilterInGrid = useCallback((key) => {
    const root = shellRef.current;
    const sel = root?.querySelector(`[data-filter-key="${key}"] select`);
    if (sel instanceof HTMLElement) {
      sel.focus();
      sel.closest('[data-filter-key]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, []);

  const handleFilterSelect = useCallback(
    (key, value) => {
      setFilterSelects((prev) => ({ ...prev, [key]: value }));
      if (key === 'price') applyPriceTier(setMinPrice, setMaxPrice, value);
      if (key === 'open_band') applyOpenTier(setMinOpen, setMaxOpen, value);
      if (key === 'change_pct') applyChangeTier(setMinChg, setMaxChg, value);
      if (key === 'volume') applyVolumeTier(setMinVol, value);
      if (key === 'dollar_vol') applyDollarVolTier(setMinDollarVol, value);
      if (key === 'day_range') applyDayRangeTier(setMinRangePct, value);
      if (key === 'exchange') setExchange(value);
    },
    [],
  );

  const applyPreset = useCallback((preset) => {
    setScreenerPreset(preset);
    const next = buildEmptyFilterSelects();
    setMinPrice('');
    setMaxPrice('');
    setMinChg('');
    setMaxChg('');
    setMinVol('');
    setMinOpen('');
    setMaxOpen('');
    setMinDollarVol('');
    setMinRangePct('');
    setExchange('');
    if (preset === 'gainers') {
      next.change_pct = 'gt1';
      setMinChg('1');
    } else if (preset === 'losers') {
      next.change_pct = 'lt_m1';
      setMaxChg('-1');
    } else if (preset === 'high_volume') {
      next.volume = '5m';
      setMinVol('5000000');
    }
    setFilterSelects(next);
  }, []);

  const clearAllFilters = useCallback(() => {
    setScreenerPreset('default');
    setFilterSelects(buildEmptyFilterSelects());
    setMinPrice('');
    setMaxPrice('');
    setMinChg('');
    setMaxChg('');
    setMinVol('');
    setMinOpen('');
    setMaxOpen('');
    setMinDollarVol('');
    setMinRangePct('');
    setExchange('');
  }, []);

  const scan = useCallback(async () => {
    setError(null);
    setLoading(true);
    setMeta(null);
    try {
      const payload = {
        max_scan: Number(maxScan) || 300,
        sort,
        sort_dir: sortDir,
        limit: Number(limit) || 200,
      };

      if (marketScope === 'watchlist') {
        payload.symbols = watchlistSymbols.map((x) => String(x).toUpperCase().trim()).filter(Boolean);
      } else if (marketScope === 'index') {
        payload.symbols = [...INDEX_ETF_SYMBOLS];
      } else if (marketScope === 'liquid') {
        payload.universe = 'liquid';
      } else {
        payload.universe = 'tradable';
      }

      const mp = minPrice !== '' ? Number(minPrice) : null;
      const xp = maxPrice !== '' ? Number(maxPrice) : null;
      const mc = minChg !== '' ? Number(minChg) : null;
      const xc = maxChg !== '' ? Number(maxChg) : null;
      const mv = minVol !== '' ? Number(minVol) : null;
      if (mp != null && !Number.isNaN(mp)) payload.min_price = mp;
      if (xp != null && !Number.isNaN(xp)) payload.max_price = xp;
      if (mc != null && !Number.isNaN(mc)) payload.min_change_pct = mc;
      if (xc != null && !Number.isNaN(xc)) payload.max_change_pct = xc;
      if (mv != null && !Number.isNaN(mv)) payload.min_volume = mv;
      const mdv = minDollarVol !== '' ? Number(minDollarVol) : null;
      if (mdv != null && !Number.isNaN(mdv) && mdv > 0) payload.min_dollar_volume = mdv;
      const mrp = minRangePct !== '' ? Number(minRangePct) : null;
      if (mrp != null && !Number.isNaN(mrp)) payload.min_range_pct = mrp;
      const mo = minOpen !== '' ? Number(minOpen) : null;
      const xo = maxOpen !== '' ? Number(maxOpen) : null;
      if (mo != null && !Number.isNaN(mo)) payload.min_open = mo;
      if (xo != null && !Number.isNaN(xo)) payload.max_open = xo;
      if (exchange.trim()) payload.exchange = exchange.trim();

      Object.assign(payload, buildFundamentalPayload(filterSelects));

      const data = await runScreener(payload);
      let out = Array.isArray(data.rows) ? data.rows : [];

      if (filterSelects.watchlist_tag === 'in_watchlist') {
        const set = new Set(watchlistSymbols.map((x) => String(x).toUpperCase().trim()));
        out = out.filter((r) => set.has(r.symbol));
      }
      const idxTag = filterSelects.index_tag;
      if (idxTag && INDEX_SCREENER_SETS[idxTag]) {
        const set = new Set(INDEX_SCREENER_SETS[idxTag].map((x) => String(x).toUpperCase().trim()));
        out = out.filter((r) => set.has(r.symbol));
      }

      setRows(out);
      setMeta(data.meta || null);
    } catch (e) {
      setRows([]);
      setError(e.message || 'Screener failed');
    } finally {
      setLoading(false);
    }
  }, [
    marketScope,
    watchlistSymbols,
    filterSelects,
    maxScan,
    minPrice,
    maxPrice,
    minChg,
    maxChg,
    minVol,
    minOpen,
    maxOpen,
    minDollarVol,
    minRangePct,
    exchange,
    sort,
    sortDir,
    limit,
  ]);

  const pick = (symbol) => {
    if (onPickSymbol) onPickSymbol(symbol);
    if (onGoToChart) onGoToChart();
  };

  const showExtended = columnPreset === 'extended';
  const showOhlc = columnPreset !== 'minimal';
  const tableColCount = 6 + (showExtended ? 1 : 0) + (showOhlc ? 4 : 0);

  const showCustomPrice = filterSelects.price === 'custom';
  const showCustomChg = filterSelects.change_pct === 'custom_chg';
  const showCustomVol = filterSelects.volume === 'custom_vol';
  const showCustomOpen = filterSelects.open_band === 'o_custom';
  const showCustomDv = filterSelects.dollar_vol === 'custom_dv';
  const showCustomRange = filterSelects.day_range === 'custom_range';

  const inner = (
    <div ref={shellRef} style={s.shell}>
      <div style={s.topBar}>
        <select
          style={s.selectTitle}
          value={screenerPreset}
          onChange={(e) => applyPreset(e.target.value)}
          aria-label="Screener template"
        >
          {SCREENER_PRESET_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div style={s.iconRow}>
          <button
            type="button"
            style={s.iconBtn}
            title={maximized ? 'Exit full window' : 'Maximize'}
            onClick={() => setMaximized((m) => !m)}
          >
            {maximized ? <IconMinimize /> : <IconMaximize />}
          </button>
          {onClose && (
            <button type="button" style={s.iconBtn} title="Close screener" onClick={onClose}>
              <IconClose />
            </button>
          )}
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <div style={s.subBar}>
          <select
            style={{ ...s.selectSm, width: 'auto', minWidth: 200 }}
            value={marketScope}
            onChange={(e) => setMarketScope(e.target.value)}
            aria-label="Market universe"
          >
            {MARKET_UNIVERSE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div style={s.iconRow}>
            <button
              type="button"
              style={s.iconBtn}
              title="Screener settings"
              onClick={(e) => {
                e.stopPropagation();
                setSettingsOpen((o) => !o);
              }}
            >
              <IconSettings />
            </button>
            <button
              type="button"
              style={s.iconBtn}
              title={filtersExpanded ? 'Hide filters' : 'Show filters'}
              onClick={() => setFiltersExpanded((v) => !v)}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>{filtersExpanded ? '▲' : '▼'}</span>
            </button>
          </div>
        </div>

        {settingsOpen && (
          <div style={s.settingsPanel} onClick={(e) => e.stopPropagation()}>
            <div style={{ ...s.label, ...s.settingsFull }}>Scan limits (dropdowns)</div>
            <label style={s.filterCell}>
              <span style={s.filterLabel}>Max symbols</span>
              <select style={s.selectSm} value={String(maxScan)} onChange={(e) => setMaxScan(Number(e.target.value) || 300)}>
                {MAX_SCAN_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={s.filterCell}>
              <span style={s.filterLabel}>Max rows</span>
              <select style={s.selectSm} value={String(limit)} onChange={(e) => setLimit(Number(e.target.value) || 200)}>
                {LIMIT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ ...s.filterCell, ...s.settingsFull }}>
              <span style={s.filterLabel}>Sort by</span>
              <select style={s.selectSm} value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORT_FIELD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ ...s.filterCell, ...s.settingsFull }}>
              <span style={s.filterLabel}>Direction</span>
              <select style={s.selectSm} value={sortDir} onChange={(e) => setSortDir(e.target.value)}>
                {SORT_DIR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {filtersExpanded && (
        <>
          {FILTER_DROPDOWN_ROWS.map((row, ri) => (
            <div key={ri} style={s.filterGrid}>
              {row.map((f) => (
                <label key={f.key} data-filter-key={f.key} style={s.filterCell}>
                  <span style={s.filterLabel}>{f.label}</span>
                  <select
                    style={s.selectSm}
                    value={filterSelects[f.key] ?? ''}
                    onChange={(e) => handleFilterSelect(f.key, e.target.value)}
                  >
                    {f.options.map((o) => (
                      <option key={`${f.key}-${o.value || 'empty'}`} value={o.value} disabled={o.disabled}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {ri === FILTER_DROPDOWN_ROWS.length - 1 && (
                <>
                  <div style={{ ...s.filterCell, ...s.filtersMenuAnchor }} ref={filtersMenuRef}>
                    <span style={s.filterLabel}>Filters</span>
                    <button
                      type="button"
                      style={s.filtersTrigger}
                      aria-expanded={filtersPickerOpen}
                      aria-haspopup="dialog"
                      aria-label="Open filter categories"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFiltersPickerCategoryId(null);
                        setFiltersPickerSearch('');
                        setFiltersPickerOpen((open) => !open);
                      }}
                    >
                      <span style={{ color: 'var(--text-secondary)', flex: 1, textAlign: 'left' }}>
                        {filtersPickerOpen ? 'Close menu' : 'Browse categories…'}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 10, lineHeight: 1 }}>▾</span>
                    </button>
                    {filtersPickerOpen && (
                      <div style={s.filtersPanel} role="dialog" aria-label="Filters">
                        <div style={s.filtersPanelTitle}>Filters</div>
                        {!filtersPickerCategoryId ? (
                          <>
                            <input
                              style={s.filtersSearchInput}
                              type="search"
                              placeholder="Search"
                              value={filtersPickerSearch}
                              onChange={(e) => setFiltersPickerSearch(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label="Search filter categories"
                            />
                            <div style={s.filtersScroll}>
                              {filteredFilterCategories.length === 0 ? (
                                <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--text-muted)' }}>No matches</div>
                              ) : (
                                filteredFilterCategories.map((cat) => (
                                  <button
                                    key={cat.id}
                                    type="button"
                                    style={s.filterCatRow}
                                    onClick={() => {
                                      setFiltersPickerCategoryId(cat.id);
                                      setFiltersPickerSearch('');
                                    }}
                                  >
                                    <span style={s.filterCatIcon}>
                                      <FilterCategoryIcon categoryId={cat.id} />
                                    </span>
                                    <span>{cat.label}</span>
                                    <span style={s.filterCatCount}>{cat.filterKeys.length}</span>
                                  </button>
                                ))
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              style={s.filtersBackBtn}
                              onClick={() => {
                                setFiltersPickerCategoryId(null);
                                setFiltersPickerSearch('');
                              }}
                            >
                              ← {activeFilterCategory?.label || 'Categories'}
                            </button>
                            <input
                              style={s.filtersSearchInput}
                              type="search"
                              placeholder="Search"
                              value={filtersPickerSearch}
                              onChange={(e) => setFiltersPickerSearch(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label="Search in category"
                            />
                            <div style={s.filtersScroll}>
                              {filteredKeysInCategory.length === 0 ? (
                                <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--text-muted)' }}>No matches</div>
                              ) : (
                                filteredKeysInCategory.map((key) => (
                                  <button
                                    key={key}
                                    type="button"
                                    style={s.filterKeyRow}
                                    onClick={() => {
                                      focusFilterInGrid(key);
                                      setFiltersPickerOpen(false);
                                      setFiltersPickerCategoryId(null);
                                      setFiltersPickerSearch('');
                                    }}
                                  >
                                    {FILTER_LABEL_BY_KEY[key] || key}
                                  </button>
                                ))
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <label style={s.filterCell}>
                    <span style={s.filterLabel}>More</span>
                    <select style={s.selectSm} defaultValue="" aria-label="More actions">
                      {MORE_ACTION_OPTIONS.map((o) => (
                        <option key={o.value || 'more-empty'} value={o.value} disabled={o.disabled}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>
          ))}

          {(showCustomPrice ||
            showCustomChg ||
            showCustomVol ||
            showCustomOpen ||
            showCustomDv ||
            showCustomRange) && (
            <div style={s.customRow}>
              {showCustomPrice && (
                <>
                  <label>
                    <span style={s.label}>Custom min last price</span>
                    <input style={s.input} type="number" step="0.01" placeholder="Min" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
                  </label>
                  <label>
                    <span style={s.label}>Custom max last price</span>
                    <input style={s.input} type="number" step="0.01" placeholder="Max" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
                  </label>
                </>
              )}
              {showCustomOpen && (
                <>
                  <label>
                    <span style={s.label}>Custom min open</span>
                    <input style={s.input} type="number" step="0.01" placeholder="Min open" value={minOpen} onChange={(e) => setMinOpen(e.target.value)} />
                  </label>
                  <label>
                    <span style={s.label}>Custom max open</span>
                    <input style={s.input} type="number" step="0.01" placeholder="Max open" value={maxOpen} onChange={(e) => setMaxOpen(e.target.value)} />
                  </label>
                </>
              )}
              {showCustomChg && (
                <>
                  <label>
                    <span style={s.label}>Custom min %</span>
                    <input style={s.input} type="number" step="0.1" placeholder="Min %" value={minChg} onChange={(e) => setMinChg(e.target.value)} />
                  </label>
                  <label>
                    <span style={s.label}>Custom max %</span>
                    <input style={s.input} type="number" step="0.1" placeholder="Max %" value={maxChg} onChange={(e) => setMaxChg(e.target.value)} />
                  </label>
                </>
              )}
              {showCustomVol && (
                <label
                  style={{
                    gridColumn: showCustomPrice || showCustomChg || showCustomOpen ? '1 / -1' : undefined,
                  }}
                >
                  <span style={s.label}>Custom min share volume</span>
                  <input style={s.input} type="number" min={0} placeholder="Shares" value={minVol} onChange={(e) => setMinVol(e.target.value)} />
                </label>
              )}
              {showCustomDv && (
                <label style={{ gridColumn: '1 / -1' }}>
                  <span style={s.label}>Custom min dollar volume (last × volume, USD)</span>
                  <input style={s.input} type="number" min={0} placeholder="e.g. 50000000" value={minDollarVol} onChange={(e) => setMinDollarVol(e.target.value)} />
                </label>
              )}
              {showCustomRange && (
                <label style={{ gridColumn: '1 / -1' }}>
                  <span style={s.label}>Custom min daily range % (high − low vs prev. close)</span>
                  <input style={s.input} type="number" step="0.1" min={0} placeholder="e.g. 3" value={minRangePct} onChange={(e) => setMinRangePct(e.target.value)} />
                </label>
              )}
            </div>
          )}

          <div style={{ padding: '0 14px 12px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={s.btnGhost} onClick={clearAllFilters}>
              Clear all filters
            </button>
          </div>
        </>
      )}

      <div style={s.bottomBar}>
        <div style={s.viewSeg}>
          <button type="button" style={s.viewSegBtn(viewMode === 'table')} title="Table view" onClick={() => setViewMode('table')}>
            <IconGrid />
            Table
          </button>
          <button type="button" style={s.viewSegBtn(viewMode === 'chart')} title="Chart view" onClick={() => setViewMode('chart')}>
            <IconChart />
            Chart
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
            <IconBars />
            <select style={{ ...s.selectSm, width: 'auto', minWidth: 140 }} value={columnPreset} onChange={(e) => setColumnPreset(e.target.value)} aria-label="Column layout">
              {COLUMN_PRESET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>
          <button type="button" style={s.iconBtn} title="Refresh scan" onClick={() => scan()} disabled={loading}>
            <IconRefresh />
          </button>
        </div>
      </div>

      <div style={s.rowActions}>
        <button type="button" style={s.btn} disabled={loading} onClick={() => scan()}>
          {loading ? 'Scanning…' : 'Scan'}
        </button>
        {meta && <span style={s.meta}>Scanned {meta.scanned} · {meta.returned} rows</span>}
      </div>
      {error && <div style={s.err}>{error}</div>}

      {viewMode === 'table' ? (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Symbol</th>
                <th style={s.th}>Name</th>
                <th style={s.th}>Exch</th>
                <th style={{ ...s.th, ...s.num }}>Last</th>
                <th style={{ ...s.th, ...s.num }}>% Chg</th>
                <th style={{ ...s.th, ...s.num }}>Volume</th>
                {showExtended && <th style={{ ...s.th, ...s.num }}>Prev close</th>}
                {showOhlc && (
                  <>
                    <th style={{ ...s.th, ...s.num }}>Open</th>
                    <th style={{ ...s.th, ...s.num }}>High</th>
                    <th style={{ ...s.th, ...s.num }}>Low</th>
                    <th style={{ ...s.th, ...s.num }}>Close</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ch = r.change_pct;
                const chCls = ch == null ? {} : ch >= 0 ? s.pos : s.neg;
                return (
                  <tr key={r.symbol}>
                    <td style={s.td}>
                      <button
                        type="button"
                        style={{ ...s.sym, background: 'none', border: 'none', padding: 0, font: 'inherit' }}
                        title="Open in chart"
                        onClick={() => pick(r.symbol)}
                      >
                        {r.symbol}
                      </button>
                    </td>
                    <td style={{ ...s.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name || ''}>
                      {r.name || '—'}
                    </td>
                    <td style={s.td}>{r.exchange || '—'}</td>
                    <td style={{ ...s.td, ...s.num }}>{num(r.last)}</td>
                    <td style={{ ...s.td, ...s.num, ...chCls }}>{ch == null ? '—' : `${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%`}</td>
                    <td style={{ ...s.td, ...s.num }}>{volFmt(r.volume)}</td>
                    {showExtended && <td style={{ ...s.td, ...s.num }}>{num(r.prev_close)}</td>}
                    {showOhlc && (
                      <>
                        <td style={{ ...s.td, ...s.num }}>{num(r.open)}</td>
                        <td style={{ ...s.td, ...s.num }}>{num(r.high)}</td>
                        <td style={{ ...s.td, ...s.num }}>{num(r.low)}</td>
                        <td style={{ ...s.td, ...s.num }}>{num(r.close)}</td>
                      </>
                    )}
                  </tr>
                );
              })}
              {!rows.length && !loading && (
                <tr>
                  <td colSpan={tableColCount} style={{ ...s.td, color: 'var(--text-muted)', textAlign: 'center', padding: 28 }}>
                    Run a scan to see results.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={s.chartPlaceholder}>
          Chart view shows one symbol at a time on the Chart tab. Use Table for multi-symbol scan results, or pick a row to open a chart.
        </div>
      )}
    </div>
  );

  return (
    <div style={maximized ? s.rootMax : s.root}>
      {inner}
    </div>
  );
}
