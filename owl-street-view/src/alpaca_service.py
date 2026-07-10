import asyncio
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional, List, Dict

import httpx
from alpaca.common.exceptions import APIError
from alpaca.common.enums import Sort
from alpaca.data import StockHistoricalDataClient
from alpaca.data.historical.option import OptionHistoricalDataClient
from alpaca.data.requests import (
    OptionBarsRequest,
    OptionChainRequest,
    OptionLatestQuoteRequest,
    OptionSnapshotRequest,
    StockBarsRequest,
    StockLatestQuoteRequest,
    StockSnapshotRequest,
)
from alpaca.data.timeframe import TimeFrame, TimeFrameUnit
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import (
    AssetClass,
    AssetStatus,
    ContractType,
    OrderClass,
    OrderSide,
    QueryOrderStatus,
    TimeInForce,
)
from alpaca.trading.requests import (
    ClosePositionRequest,
    GetAssetsRequest,
    GetOptionContractsRequest,
    GetOrderByIdRequest,
    GetOrdersRequest,
    LimitOrderRequest,
    MarketOrderRequest,
    ReplaceOrderRequest,
    StopLimitOrderRequest,
    StopOrderRequest,
    StopLossRequest,
    TakeProfitRequest,
    TrailingStopOrderRequest,
)
from pydantic import BaseModel, ValidationError
from fastapi import HTTPException

OCC_OPTION_RE = re.compile(r"^[A-Z]{1,6}\d{6}[CP]\d{8}$")
SCREENER_SNAPSHOT_CHUNK = 80
FMP_V3 = "https://financialmodelingprep.com/api/v3"
FMP_MAX_FUND_SYMBOLS = 500

LIQUID_UNIVERSE = tuple(
    dict.fromkeys(
        [
            "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "NVDA", "TSLA",
            "BRK.B", "UNH", "JNJ", "V", "PG", "JPM", "MA", "HD",
            "CVX", "MRK", "ABBV", "PEP", "COST", "KO", "AVGO", "WMT",
            "MCD", "CSCO", "ADBE", "BAC", "DIS", "PFE", "XOM", "CRM",
            "TMO", "ABT", "ACN", "NFLX", "DHR", "LIN", "NKE", "TXN",
            "PM", "NEE", "ORCL", "MDT", "UPS", "RTX", "HON", "QCOM",
            "AMAT", "LOW", "IBM", "SBUX", "CAT", "GE", "DE", "AMGN",
            "GS", "BKNG", "INTU", "AXP", "ISRG", "BLK", "GILD", "NOW",
            "MDLZ", "SO", "ADI", "CVS", "CI", "TJX", "REGN", "MO",
            "TGT", "PLD", "DUK", "SCHW", "AMT", "EOG", "CME", "EQIX",
            "ITW", "PSX", "AON", "ICE", "SHW", "SPGI", "MCO", "HUM",
            "USB", "ETN", "PGR", "EW", "MET", "AEP", "DXCM", "SNPS",
            "CDNS", "WM", "CMCSA", "FDX", "ROST", "IDXX", "OXY", "MPC",
            "AFL", "TRV", "DAL", "BA", "LMT", "INTC", "AMD", "PLTR",
            "COIN", "HOOD", "SOFI", "SPY", "QQQ", "IWM", "DIA", "XLF",
            "XLE", "XLK", "XLV", "TLT", "GLD", "SMH", "VXX", "ARKK",
            "EEM", "VNQ",
        ]
    ).keys()
)

def is_option_symbol(symbol: str) -> bool:
    """Standard OCC contract symbol (equity + index options)."""
    return bool(OCC_OPTION_RE.fullmatch(symbol.strip().upper()))

def parse_occ_option_parts(symbol: str) -> Optional[dict[str, Any]]:
    m = re.fullmatch(r"([A-Z]{1,6})(\d{6})([CP])(\d{8})", symbol.strip().upper())
    if not m:
        return None
    root, yymmdd, cp, strike_s = m.groups()
    return {
        "root": root,
        "expiration": f"20{yymmdd[0:2]}-{yymmdd[2:4]}-{yymmdd[4:6]}",
        "type": "call" if cp == "C" else "put",
        "strike": int(strike_s) / 1000.0,
    }

# ── Request Models ─────────────────────────────────────────────────────────────

class MarketOrderBody(BaseModel):
    symbol: str
    qty: float
    side: str  # "buy" | "sell"
    time_in_force: str = "day"

class LimitOrderBody(BaseModel):
    symbol: str
    qty: float
    side: str
    limit_price: float
    time_in_force: str = "day"

class AdvancedOrderBody(BaseModel):
    symbol: str
    side: str  # buy | sell
    order_type: str = "market"  # market | limit | stop | stop_limit | trailing_stop
    qty: Optional[float] = None
    notional: Optional[float] = None
    time_in_force: str = "day"
    limit_price: Optional[float] = None
    stop_price: Optional[float] = None
    trail_price: Optional[float] = None
    trail_percent: Optional[float] = None
    extended_hours: bool = False
    client_order_id: Optional[str] = None
    order_class: str = "simple"  # simple | bracket | oco | oto
    take_profit_limit_price: Optional[float] = None
    stop_loss_stop_price: Optional[float] = None
    stop_loss_limit_price: Optional[float] = None

class ReplaceOrderBody(BaseModel):
    qty: Optional[float] = None
    time_in_force: Optional[str] = None
    limit_price: Optional[float] = None
    stop_price: Optional[float] = None
    trail: Optional[float] = None
    client_order_id: Optional[str] = None

class ClosePositionBody(BaseModel):
    symbol: str
    qty: Optional[float] = None

class ScreenerRequest(BaseModel):
    universe: str = "liquid"  # liquid | tradable
    symbols: Optional[list[str]] = None
    max_scan: int = 300
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    min_change_pct: Optional[float] = None
    max_change_pct: Optional[float] = None
    min_volume: Optional[float] = None
    min_dollar_volume: Optional[float] = None
    min_range_pct: Optional[float] = None
    min_open: Optional[float] = None
    max_open: Optional[float] = None
    exchange: Optional[str] = None
    sort: str = "change_pct"
    sort_dir: str = "desc"
    limit: int = 200
    min_market_cap: Optional[float] = None
    max_market_cap: Optional[float] = None
    min_pe: Optional[float] = None
    max_pe: Optional[float] = None
    min_peg: Optional[float] = None
    max_peg: Optional[float] = None
    min_roe: Optional[float] = None
    max_roe: Optional[float] = None
    min_dividend_yield: Optional[float] = None
    max_dividend_yield: Optional[float] = None
    min_beta: Optional[float] = None
    max_beta: Optional[float] = None
    sector: Optional[str] = None
    min_eps_growth: Optional[float] = None
    max_eps_growth: Optional[float] = None
    min_revenue_growth: Optional[float] = None
    max_revenue_growth: Optional[float] = None

# ── Alpaca and FMP Service Wrapper ─────────────────────────────────────────────

class AlpacaService:
    def __init__(self, api_key: str, secret_key: str, is_paper: bool = True, fmp_api_key: Optional[str] = None):
        self.api_key = api_key
        self.secret_key = secret_key
        self.is_paper = is_paper
        self.fmp_api_key = (fmp_api_key or "").strip()

        self.trading_client = TradingClient(api_key, secret_key, paper=is_paper)
        self.data_client = StockHistoricalDataClient(api_key, secret_key)
        self.option_data_client = OptionHistoricalDataClient(api_key, secret_key)

    def get_account(self):
        account = self.trading_client.get_account()
        return {
            "id": str(account.id),
            "status": str(account.status),
            "currency": account.currency,
            "buying_power": float(account.buying_power),
            "cash": float(account.cash),
            "portfolio_value": float(account.portfolio_value),
            "equity": float(account.equity),
            "last_equity": float(account.last_equity),
            "day_trade_count": account.daytrade_count,
            "pattern_day_trader": account.pattern_day_trader,
        }

    def get_market_clock(self):
        c = self.trading_client.get_clock()
        return {
            "is_open": c.is_open,
            "timestamp": c.timestamp.isoformat() if c.timestamp else None,
            "next_open": c.next_open.isoformat() if c.next_open else None,
            "next_close": c.next_close.isoformat() if c.next_close else None,
        }

    def get_positions(self):
        positions = self.trading_client.get_all_positions()
        return [
            {
                "symbol": p.symbol,
                "qty": float(p.qty),
                "avg_entry_price": float(p.avg_entry_price),
                "current_price": float(p.current_price) if p.current_price else None,
                "market_value": float(p.market_value) if p.market_value else None,
                "unrealized_pl": float(p.unrealized_pl) if p.unrealized_pl else None,
                "unrealized_plpc": float(p.unrealized_plpc) if p.unrealized_plpc else None,
                "side": str(p.side),
            }
            for p in positions
        ]

    def close_position(self, symbol: str, qty: Optional[float] = None):
        sym = symbol.upper().strip()
        if qty is not None and qty > 0:
            opts = ClosePositionRequest(qty=str(qty))
            order = self.trading_client.close_position(sym, opts)
        else:
            order = self.trading_client.close_position(sym)
        return {
            "id": str(order.id),
            "status": str(order.status),
            "symbol": order.symbol,
        }

    def get_orders(self, status: str = "open", limit: int = 100):
        key = (status or "open").strip().lower()
        qstatus = {"open": QueryOrderStatus.OPEN, "closed": QueryOrderStatus.CLOSED, "all": QueryOrderStatus.ALL}.get(key)
        if qstatus is None:
            raise HTTPException(status_code=400, detail="status must be open, closed, or all")
        lim = max(1, min(limit, 500))
        req = GetOrdersRequest(status=qstatus, limit=lim, nested=True)
        orders = self.trading_client.get_orders(req)
        return [self._normalize_order(o) for o in orders]

    def get_order_detail(self, order_id: str, nested: bool = True):
        req = GetOrderByIdRequest(nested=nested)
        order = self.trading_client.get_order_by_id(order_id, req)
        return self._normalize_order(order)

    def replace_order(self, order_id: str, body: ReplaceOrderBody):
        tif = self._parse_tif(body.time_in_force) if body.time_in_force else None
        req = ReplaceOrderRequest(
            qty=body.qty,
            time_in_force=tif,
            limit_price=body.limit_price,
            stop_price=body.stop_price,
            trail=body.trail,
            client_order_id=body.client_order_id,
        )
        order = self.trading_client.replace_order_by_id(order_id, req)
        return self._normalize_order(order)

    def cancel_order(self, order_id: str):
        self.trading_client.cancel_order_by_id(order_id)
        return {"cancelled": order_id}

    def submit_advanced_order(self, body: AdvancedOrderBody) -> dict[str, Any]:
        sym = body.symbol.upper().strip()
        if not sym:
            raise HTTPException(status_code=400, detail='symbol is required')
        if body.qty is None and body.notional is None:
            raise HTTPException(status_code=400, detail='qty or notional is required')
        if body.qty is not None and body.qty <= 0:
            raise HTTPException(status_code=400, detail='qty must be > 0')
        if body.notional is not None and body.notional <= 0:
            raise HTTPException(status_code=400, detail='notional must be > 0')

        otype = (body.order_type or 'market').strip().lower()
        if otype not in {'market', 'limit', 'stop', 'stop_limit', 'trailing_stop'}:
            raise HTTPException(status_code=400, detail=f'unsupported order_type: {body.order_type}')

        self._validate_session_constraints(sym, otype, body.extended_hours)

        side = self._parse_side(body.side)
        tif = self._parse_tif(body.time_in_force)
        order_class = self._parse_order_class(body.order_class)
        tp, sl = self._build_tp_sl(body)

        common = {
            'symbol': sym,
            'side': side,
            'time_in_force': tif,
            'extended_hours': bool(body.extended_hours),
            'client_order_id': body.client_order_id,
            'order_class': order_class,
            'take_profit': tp,
            'stop_loss': sl,
        }
        if body.qty is not None:
            common['qty'] = body.qty
        if body.notional is not None:
            common['notional'] = body.notional

        if otype == 'market':
            req = MarketOrderRequest(**common)
        elif otype == 'limit':
            if body.limit_price is None or body.limit_price <= 0:
                raise HTTPException(status_code=400, detail='limit_price must be > 0 for limit orders')
            req = LimitOrderRequest(limit_price=body.limit_price, **common)
        elif otype == 'stop':
            if body.stop_price is None or body.stop_price <= 0:
                raise HTTPException(status_code=400, detail='stop_price must be > 0 for stop orders')
            req = StopOrderRequest(stop_price=body.stop_price, **common)
        elif otype == 'stop_limit':
            if body.stop_price is None or body.stop_price <= 0:
                raise HTTPException(status_code=400, detail='stop_price must be > 0 for stop_limit orders')
            if body.limit_price is None or body.limit_price <= 0:
                raise HTTPException(status_code=400, detail='limit_price must be > 0 for stop_limit orders')
            req = StopLimitOrderRequest(stop_price=body.stop_price, limit_price=body.limit_price, **common)
        else:
            if body.trail_price is None and body.trail_percent is None:
                raise HTTPException(status_code=400, detail='trail_price or trail_percent required for trailing_stop')
            if body.trail_price is not None and body.trail_percent is not None:
                raise HTTPException(status_code=400, detail='use only one of trail_price or trail_percent')
            kw = dict(common)
            if body.trail_price is not None:
                kw['trail_price'] = body.trail_price
            if body.trail_percent is not None:
                kw['trail_percent'] = body.trail_percent
            req = TrailingStopOrderRequest(**kw)

        order = self.trading_client.submit_order(req)
        return self._normalize_order(order)

    # ── Market Data ────────────────────────────────────────────────────────────

    def get_quote(self, symbol: str):
        sym = symbol.upper()
        is_opt = is_option_symbol(sym)
        if is_opt:
            req = OptionLatestQuoteRequest(symbol_or_symbols=sym)
            quotes = self.option_data_client.get_option_latest_quote(req)
            q = quotes[sym]
        else:
            req = StockLatestQuoteRequest(symbol_or_symbols=sym)
            quotes = self.data_client.get_stock_latest_quote(req)
            q = quotes[sym]
        return {
            "symbol": sym,
            "asset_class": "option" if is_opt else "stock",
            "ask_price": float(q.ask_price),
            "bid_price": float(q.bid_price),
            "ask_size": float(q.ask_size),
            "bid_size": float(q.bid_size),
            "timestamp": q.timestamp.isoformat(),
        }

    def get_snapshot(self, symbol: str):
        sym = symbol.upper()
        if is_option_symbol(sym):
            req = OptionSnapshotRequest(symbol_or_symbols=sym)
            snaps = self.option_data_client.get_option_snapshot(req)
            s = snaps[sym]
            g = s.greeks
            return {
                "symbol": sym,
                "asset_class": "option",
                "latest_trade_price": float(s.latest_trade.price) if s.latest_trade else None,
                "latest_quote_ask": float(s.latest_quote.ask_price) if s.latest_quote else None,
                "latest_quote_bid": float(s.latest_quote.bid_price) if s.latest_quote else None,
                "daily_bar": None,
                "prev_daily_bar": None,
                "implied_volatility": float(s.implied_volatility) if s.implied_volatility is not None else None,
                "greeks": {
                    "delta": float(g.delta),
                    "gamma": float(g.gamma),
                    "theta": float(g.theta),
                    "vega": float(g.vega),
                    "rho": float(g.rho),
                } if g else None,
            }
        req = StockSnapshotRequest(symbol_or_symbols=sym)
        snaps = self.data_client.get_stock_snapshot(req)
        s = snaps[sym]
        return {
            "symbol": sym,
            "asset_class": "stock",
            "latest_trade_price": float(s.latest_trade.price) if s.latest_trade else None,
            "latest_quote_ask": float(s.latest_quote.ask_price) if s.latest_quote else None,
            "latest_quote_bid": float(s.latest_quote.bid_price) if s.latest_quote else None,
            "daily_bar": {
                "open": float(s.daily_bar.open),
                "high": float(s.daily_bar.high),
                "low": float(s.daily_bar.low),
                "close": float(s.daily_bar.close),
                "volume": float(s.daily_bar.volume),
            } if s.daily_bar else None,
            "prev_daily_bar": {
                "close": float(s.previous_daily_bar.close),
            } if s.previous_daily_bar else None,
        }

    # ── Screener Execution ──────────────────────────────────────────────────────

    def run_screener(self, body: ScreenerRequest):
        out_limit = max(5, min(int(body.limit), 500))
        sort_key = (body.sort or "change_pct").strip().lower()
        sort_dir = (body.sort_dir or "desc").strip().lower()
        if sort_dir not in {"asc", "desc"}:
            raise HTTPException(status_code=400, detail="sort_dir must be asc or desc")
        allowed_sort = {"change_pct", "last", "volume", "symbol", "name", "market_cap", "pe", "beta"}
        if sort_key not in allowed_sort:
            raise HTTPException(status_code=400, detail=f"sort must be one of: {', '.join(sorted(allowed_sort))}")

        symbols, meta = self._resolve_screener_universe(body)
        scanned = len(symbols)
        if not symbols:
            return {"rows": [], "meta": {"scanned": 0, "returned": 0, "message": "no symbols in universe"}}

        snaps = self._fetch_stock_snapshots_map(symbols)
        rows: list[dict[str, Any]] = []
        ex_needle = body.exchange.strip().upper() if body.exchange else None

        for sym in symbols:
            s = snaps.get(sym)
            if s is None:
                continue
            m = meta.get(sym) or {}
            row = self._row_from_stock_snapshot(sym, s, m.get("name"), m.get("exchange"))

            last = row.get("last")
            vol = row.get("volume")
            chg = row.get("change_pct")

            if body.min_price is not None and (last is None or last < body.min_price):
                continue
            if body.max_price is not None and (last is None or last > body.max_price):
                continue
            if body.min_volume is not None and (vol is None or vol < body.min_volume):
                continue
            if body.min_dollar_volume is not None:
                if last is None or vol is None or (last * vol) < body.min_dollar_volume:
                    continue
            if body.min_range_pct is not None:
                prev_c = row.get("prev_close")
                hi = row.get("high")
                lo = row.get("low")
                if prev_c is None or hi is None or lo is None or prev_c <= 0:
                    continue
                rng_pct = (hi - lo) / prev_c * 100.0
                if rng_pct < body.min_range_pct:
                    continue
            if body.min_open is not None:
                op = row.get("open")
                if op is None or op < body.min_open:
                    continue
            if body.max_open is not None:
                op = row.get("open")
                if op is None or op > body.max_open:
                    continue
            if body.min_change_pct is not None and (chg is None or chg < body.min_change_pct):
                continue
            if body.max_change_pct is not None and (chg is None or chg > body.max_change_pct):
                continue
            if ex_needle:
                rex = (row.get("exchange") or "").upper()
                if rex and ex_needle not in rex:
                    continue

            rows.append(row)

        fmp_meta: dict[str, Any] = {}
        if self._screener_needs_fmp(body):
            if not self.fmp_api_key:
                raise HTTPException(
                    status_code=400,
                    detail="Fundamental filters or sort (market_cap, pe, beta) require FMP_API_KEY.",
                )
            pre_n = len(rows)
            if pre_n > FMP_MAX_FUND_SYMBOLS:
                rows = rows[:FMP_MAX_FUND_SYMBOLS]
                fmp_meta["fundamentals_truncated"] = True
                fmp_meta["fundamentals_truncated_from"] = pre_n
                fmp_meta["fundamentals_max_symbols"] = FMP_MAX_FUND_SYMBOLS
            syms_f = [str(r.get("symbol") or "").upper() for r in rows if r.get("symbol")]
            qp = self._fmp_quote_and_profile(syms_f, self.fmp_api_key)
            km: dict[str, Any] = {}
            if self._screener_needs_key_metrics(body) or sort_key in {"pe", "market_cap", "beta"}:
                km = self._fmp_key_metrics_parallel(syms_f, self.fmp_api_key)
            gr: dict[str, Any] = {}
            if self._screener_needs_growth_fetch(body):
                gr = self._fmp_financial_growth_parallel(syms_f, self.fmp_api_key)
            for r in rows:
                self._merge_fmp_into_row(r, qp, km, gr)
            rows = [r for r in rows if self._passes_fundamental_filters(r, body)]
            fmp_meta["fundamentals"] = "fmp"

        reverse = sort_dir == "desc"

        def sort_val(r: dict) -> Any:
            if sort_key == "symbol":
                return (r.get("symbol") or "").upper()
            if sort_key == "name":
                return (r.get("name") or "").upper()
            if sort_key == "market_cap":
                v = r.get("fund_market_cap")
                if v is None:
                    return float("-inf") if reverse else float("inf")
                return float(v)
            if sort_key == "pe":
                v = r.get("fund_pe")
                if v is None:
                    return float("-inf") if reverse else float("inf")
                return float(v)
            if sort_key == "beta":
                v = r.get("fund_beta")
                if v is None:
                    return float("-inf") if reverse else float("inf")
                return float(v)
            v = r.get(sort_key)
            if v is None:
                return float("-inf") if reverse else float("inf")
            return float(v)

        rows.sort(key=sort_val, reverse=reverse)
        rows = rows[:out_limit]

        out_meta = {
            "scanned": scanned,
            "snapshots": len(snaps),
            "returned": len(rows),
            "universe": body.universe,
            "max_scan": max(10, min(int(body.max_scan), 1500)),
        }
        out_meta.update(fmp_meta)

        return {"rows": rows, "meta": out_meta}

    # ── Historical Bars ─────────────────────────────────────────────────────────

    def get_bars(self, symbol: str, timeframe: str = "1D", start: Optional[str] = None, end: Optional[str] = None, limit: Optional[int] = None):
        sym = symbol.upper()
        TIMEFRAME_MAP = {
            "1MIN": (TimeFrame(1, TimeFrameUnit.Minute), timedelta(days=3)),
            "5MIN": (TimeFrame(5, TimeFrameUnit.Minute), timedelta(days=10)),
            "10MIN": (TimeFrame(10, TimeFrameUnit.Minute), timedelta(days=15)),
            "15MIN": (TimeFrame(15, TimeFrameUnit.Minute), timedelta(days=20)),
            "1H": (TimeFrame(1, TimeFrameUnit.Hour), timedelta(days=90)),
            "5H": (TimeFrame(5, TimeFrameUnit.Hour), timedelta(days=180)),
            "1D": (TimeFrame(1, TimeFrameUnit.Minute), timedelta(hours=8)),
            "5D": (TimeFrame(15, TimeFrameUnit.Minute), timedelta(days=5)),
            "1M": (TimeFrame(1, TimeFrameUnit.Hour), timedelta(days=30)),
            "3M": (TimeFrame(1, TimeFrameUnit.Hour), timedelta(days=90)),
            "1Y": (TimeFrame(1, TimeFrameUnit.Day), timedelta(days=365)),
            "5Y": (TimeFrame(1, TimeFrameUnit.Day), timedelta(days=365 * 5)),
        }
        try:
            tf_key = timeframe.strip().upper()
            tf, delta = TIMEFRAME_MAP.get(tf_key, TIMEFRAME_MAP["1D"])
            now = datetime.now(timezone.utc)

            end_dt = self._parse_iso_dt(end) if end else now
            start_dt = self._parse_iso_dt(start) if start else (end_dt - delta)

            if start_dt >= end_dt:
                raise HTTPException(status_code=400, detail="start must be before end")

            max_span = timedelta(days=365 * 30) if tf_key in {"1Y", "5Y", "3M", "1M"} else timedelta(days=365 * 12)
            if end_dt - start_dt > max_span:
                raise HTTPException(status_code=400, detail=f"requested window too large (max {max_span.days} days for {tf_key})")

            lim = 5000 if limit is None else int(limit)
            lim = max(1, min(lim, 10000))

            fetch_sort = Sort.ASC
            if start is None and limit is not None:
                fetch_sort = Sort.DESC

            if is_option_symbol(sym):
                req = OptionBarsRequest(
                    symbol_or_symbols=sym,
                    timeframe=tf,
                    start=start_dt,
                    end=end_dt,
                    limit=lim,
                    sort=fetch_sort,
                )
                bars = self.option_data_client.get_option_bars(req)
            else:
                req = StockBarsRequest(
                    symbol_or_symbols=sym,
                    timeframe=tf,
                    start=start_dt,
                    end=end_dt,
                    limit=lim,
                    sort=fetch_sort,
                    feed="iex",
                )
                bars = self.data_client.get_stock_bars(req)
            bar_list = self._bar_list_for_symbol(bars, sym)
            bar_list.sort(key=lambda b: b.timestamp)
            return [
                {
                    "time": b.timestamp.isoformat(),
                    "open": float(b.open),
                    "high": float(b.high),
                    "low": float(b.low),
                    "close": float(b.close),
                    "volume": float(b.volume),
                }
                for b in bar_list
            ]
        except APIError as e:
            raise HTTPException(status_code=502, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    # ── Option Chain / Expirations ──────────────────────────────────────────────

    def get_option_expirations(self, underlying: str, horizon_days: int = 548):
        u = underlying.upper().strip()
        if not u:
            raise HTTPException(status_code=400, detail="underlying required")
        horizon_days = max(7, min(int(horizon_days), 800))
        today = date.today()
        end = today + timedelta(days=horizon_days)
        seen: set[str] = set()
        source = "contracts"

        try:
            cursor = today
            win = timedelta(days=90)
            while cursor <= end:
                win_end = min(cursor + win, end)
                page_token: Optional[str] = None
                for _ in range(100):
                    req = GetOptionContractsRequest(
                        underlying_symbols=[u],
                        status=AssetStatus.ACTIVE,
                        expiration_date_gte=cursor.isoformat(),
                        expiration_date_lte=win_end.isoformat(),
                        limit=1000,
                        page_token=page_token,
                    )
                    resp = self.trading_client.get_option_contracts(req)
                    for c in resp.option_contracts or []:
                        ed = c.expiration_date
                        seen.add(ed.isoformat() if hasattr(ed, "isoformat") else str(ed)[:10])
                    page_token = resp.next_page_token
                    if not page_token:
                        break
                cursor = win_end + timedelta(days=1)
        except APIError as e:
            raw = e.args[0] if e.args else ""
            try:
                msg = json.loads(raw).get("message", raw)
            except Exception:
                msg = raw or str(e)
            try:
                seen = self._expirations_from_option_chain(u, today, end)
                source = "market_data_chain"
            except Exception as fe:
                status = getattr(e, "status_code", None) or 422
                if not (400 <= status < 600):
                    status = 422
                raise HTTPException(status_code=status, detail=f"{msg}. Fallback failed: {fe}") from e
        except ValidationError:
            try:
                seen = self._expirations_from_option_chain(u, today, end)
                source = "market_data_chain"
            except Exception as fe:
                raise HTTPException(status_code=502, detail=f"ValidationError. Fallback failed: {fe}") from fe

        return {"underlying": u, "expirations": sorted(seen), "source": source}

    def get_option_chain(self, underlying: str, expiration_date: Optional[str] = None, contract_type: Optional[str] = None, limit: int = 80):
        u = underlying.upper().strip()
        try:
            kwargs: dict[str, Any] = {"underlying_symbol": u}
            if expiration_date:
                kwargs["expiration_date"] = expiration_date
            if contract_type and contract_type.lower() in ("call", "put"):
                kwargs["type"] = ContractType.CALL if contract_type.lower() == "call" else ContractType.PUT
            req = OptionChainRequest(**kwargs)
            chain = self.option_data_client.get_option_chain(req)
            rows = []
            for sym, snap in chain.items():
                lt = snap.latest_trade.price if snap.latest_trade else None
                bq = snap.latest_quote
                bid = float(bq.bid_price) if bq else None
                ask = float(bq.ask_price) if bq else None
                g = snap.greeks
                parts = parse_occ_option_parts(sym)
                rows.append(
                    {
                        "symbol": sym,
                        "bid": bid,
                        "ask": ask,
                        "last": float(lt) if lt is not None else None,
                        "implied_volatility": float(snap.implied_volatility) if snap.implied_volatility is not None else None,
                        "delta": float(g.delta) if g else None,
                        "strike": parts["strike"] if parts else None,
                        "expiration": parts["expiration"] if parts else None,
                        "right": parts["type"] if parts else None,
                    }
                )
            rows.sort(key=lambda r: float(r["strike"] or 0))
            return rows[: max(1, min(limit, 500))]
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    def get_option_chain_matrix(self, underlying: str, expiration_date: str, wing: int = 32, center_strike: Optional[float] = None):
        u = underlying.upper().strip()
        exp = expiration_date.strip()
        if not exp:
            raise HTTPException(status_code=400, detail="expiration_date is required (YYYY-MM-DD)")
        wing = max(5, min(int(wing), 120))
        try:
            req = OptionChainRequest(underlying_symbol=u, expiration_date=exp)
            chain = self.option_data_client.get_option_chain(req)
            by_strike: dict[float, dict[str, Any]] = {}
            for sym, snap in chain.items():
                parts = parse_occ_option_parts(sym)
                if not parts or parts.get("expiration") != exp:
                    continue
                k = float(parts["strike"])
                if k not in by_strike:
                    by_strike[k] = {"strike": k, "call": None, "put": None}
                leg = self._option_leg_dict(sym, snap)
                if parts["type"] == "call":
                    by_strike[k]["call"] = leg
                else:
                    by_strike[k]["put"] = leg

            strikes = sorted(by_strike.keys())
            spot = center_strike
            if spot is None:
                spot = self._underlying_spot_price(u)
            if spot is not None and strikes:
                idx = min(range(len(strikes)), key=lambda i: abs(strikes[i] - spot))
                lo = max(0, idx - wing)
                hi = min(len(strikes), idx + wing + 1)
                strikes = strikes[lo:hi]
            elif len(strikes) > 2 * wing + 1:
                mid = len(strikes) // 2
                strikes = strikes[mid - wing : mid + wing + 1]

            rows = [by_strike[k] for k in strikes]
            return {
                "underlying": u,
                "expiration": exp,
                "spot": spot,
                "vix": self._vix_context(),
                "strikes": rows,
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    # ── Private Internal Helpers ────────────────────────────────────────────────

    def _expirations_from_option_chain(self, underlying: str, start: date, end: date) -> set[str]:
        u = underlying.upper().strip()
        seen: set[str] = set()
        step = timedelta(days=120)
        cursor = start
        while cursor <= end:
            win_end = min(cursor + step, end)
            req = OptionChainRequest(
                underlying_symbol=u,
                expiration_date_gte=cursor.isoformat(),
                expiration_date_lte=win_end.isoformat(),
            )
            chain = self.option_data_client.get_option_chain(req)
            for sym in chain.keys():
                parts = parse_occ_option_parts(sym)
                if parts and parts.get("expiration"):
                    seen.add(parts["expiration"])
            cursor = win_end + timedelta(days=1)
        return seen

    def _iv_percent(self, iv: Optional[float]) -> Optional[float]:
        if iv is None:
            return None
        v = float(iv)
        return v * 100 if (v > 0 and v <= 1) else v

    def _option_leg_dict(self, sym: str, snap: Any) -> dict[str, Any]:
        bq = snap.latest_quote
        bid = float(bq.bid_price) if bq else None
        ask = float(bq.ask_price) if bq else None
        mid = (bid + ask) / 2 if bid is not None and ask is not None else None
        lt = snap.latest_trade
        last = float(lt.price) if lt else None
        last_sz = float(lt.size) if lt else None
        g = snap.greeks
        return {
            "symbol": sym,
            "bid": bid,
            "ask": ask,
            "mid": mid,
            "last": last,
            "last_size": last_sz,
            "iv_pct": self._iv_percent(float(snap.implied_volatility) if snap.implied_volatility is not None else None),
            "delta": float(g.delta) if g else None,
            "gamma": float(g.gamma) if g else None,
            "theta": float(g.theta) if g else None,
            "vega": float(g.vega) if g else None,
            "rho": float(g.rho) if g else None,
        }

    def _underlying_spot_price(self, sym: str) -> Optional[float]:
        try:
            snaps = self.data_client.get_stock_snapshot(StockSnapshotRequest(symbol_or_symbols=sym))
            s = snaps[sym.upper()]
            if s.latest_trade:
                return float(s.latest_trade.price)
            if s.latest_quote:
                b, a = float(s.latest_quote.bid_price), float(s.latest_quote.ask_price)
                return (b + a) / 2
        except Exception:
            pass
        return None

    def _vix_context(self) -> Optional[dict[str, Any]]:
        for sym, label in (("VIX", "VIX"), ("VIXY", "VIXY"), ("VXX", "VXX")):
            try:
                snaps = self.data_client.get_stock_snapshot(StockSnapshotRequest(symbol_or_symbols=sym))
                s = snaps[sym.upper()]
                last = float(s.latest_trade.price) if s.latest_trade else None
                bid = float(s.latest_quote.bid_price) if s.latest_quote else None
                ask = float(s.latest_quote.ask_price) if s.latest_quote else None
                if last is not None or (bid is not None and ask is not None):
                    return {
                        "symbol": sym,
                        "label": label,
                        "last": last,
                        "bid": bid,
                        "ask": ask,
                        "mid": (bid + ask) / 2 if bid is not None and ask is not None else None,
                    }
            except Exception:
                continue
        return None

    def _parse_side(self, side: str) -> OrderSide:
        s = (side or '').strip().lower()
        if s == 'buy':
            return OrderSide.BUY
        if s == 'sell':
            return OrderSide.SELL
        raise HTTPException(status_code=400, detail='side must be buy or sell')

    def _parse_tif(self, tif: Optional[str], default: str = 'day') -> TimeInForce:
        v = (tif or default).strip().lower()
        mapping = {
            'day': TimeInForce.DAY,
            'gtc': TimeInForce.GTC,
            'ioc': TimeInForce.IOC,
            'fok': TimeInForce.FOK,
            'opg': TimeInForce.OPG,
            'cls': TimeInForce.CLS,
        }
        out = mapping.get(v)
        if not out:
            raise HTTPException(status_code=400, detail=f'unsupported time_in_force: {tif}')
        return out

    def _parse_order_class(self, order_class: str) -> OrderClass:
        v = (order_class or 'simple').strip().lower()
        mapping = {
            'simple': OrderClass.SIMPLE,
            'bracket': OrderClass.BRACKET,
            'oco': OrderClass.OCO,
            'oto': OrderClass.OTO,
        }
        out = mapping.get(v)
        if not out:
            raise HTTPException(status_code=400, detail=f'unsupported order_class: {order_class}')
        return out

    def _validate_session_constraints(self, symbol: str, order_type: str, extended_hours: bool):
        clock = self.trading_client.get_clock()
        mkt_open = bool(clock.is_open)
        is_opt = is_option_symbol(symbol)
        if is_opt and extended_hours:
            raise HTTPException(status_code=400, detail='Options do not support extended hours.')
        if not mkt_open and is_opt:
            raise HTTPException(status_code=400, detail='Options market is closed. Submit during regular session.')
        if not mkt_open and order_type == 'market':
            raise HTTPException(
                status_code=400,
                detail='Market is closed. Use LIMIT for after-hours equities, or wait for open.',
            )

    def _build_tp_sl(self, body: AdvancedOrderBody):
        tp = None
        sl = None
        if body.take_profit_limit_price is not None:
            if body.take_profit_limit_price <= 0:
                raise HTTPException(status_code=400, detail='take_profit_limit_price must be > 0')
            tp = TakeProfitRequest(limit_price=body.take_profit_limit_price)
        if body.stop_loss_stop_price is not None:
            if body.stop_loss_stop_price <= 0:
                raise HTTPException(status_code=400, detail='stop_loss_stop_price must be > 0')
            if body.stop_loss_limit_price is not None and body.stop_loss_limit_price <= 0:
                raise HTTPException(status_code=400, detail='stop_loss_limit_price must be > 0')
            sl = StopLossRequest(stop_price=body.stop_loss_stop_price, limit_price=body.stop_loss_limit_price)
        return tp, sl

    def _normalize_order(self, o: Any) -> dict[str, Any]:
        return {
            'id': str(o.id),
            'symbol': o.symbol,
            'qty': float(o.qty) if o.qty else None,
            'notional': float(o.notional) if getattr(o, 'notional', None) else None,
            'filled_qty': float(o.filled_qty) if o.filled_qty else 0,
            'side': str(o.side),
            'type': str(o.order_type),
            'order_class': str(o.order_class) if getattr(o, 'order_class', None) else None,
            'status': str(o.status),
            'time_in_force': str(o.time_in_force) if getattr(o, 'time_in_force', None) else None,
            'limit_price': float(o.limit_price) if o.limit_price else None,
            'stop_price': float(o.stop_price) if o.stop_price else None,
            'trail_price': float(o.trail_price) if getattr(o, 'trail_price', None) else None,
            'trail_percent': float(o.trail_percent) if getattr(o, 'trail_percent', None) else None,
            'extended_hours': bool(getattr(o, 'extended_hours', False)),
            'client_order_id': getattr(o, 'client_order_id', None),
            'filled_avg_price': float(o.filled_avg_price) if o.filled_avg_price else None,
            'created_at': o.created_at.isoformat() if o.created_at else None,
            'updated_at': o.updated_at.isoformat() if getattr(o, 'updated_at', None) else None,
            'submitted_at': o.submitted_at.isoformat() if getattr(o, 'submitted_at', None) else None,
            'legs': [self._normalize_order(leg) for leg in (o.legs or [])] if getattr(o, 'legs', None) else [],
        }

    def _fetch_stock_snapshots_map(self, symbols: list[str]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        chunk = SCREENER_SNAPSHOT_CHUNK
        for i in range(0, len(symbols), chunk):
            part = symbols[i : i + chunk]
            try:
                snaps = self.data_client.get_stock_snapshot(StockSnapshotRequest(symbol_or_symbols=part))
                if isinstance(snaps, dict):
                    for k, v in snaps.items():
                        out[str(k).strip().upper()] = v
            except APIError:
                for sym in part:
                    try:
                        snaps = self.data_client.get_stock_snapshot(StockSnapshotRequest(symbol_or_symbols=sym))
                        if not isinstance(snaps, dict):
                            continue
                        sk = sym.upper()
                        val = snaps.get(sk)
                        if val is None:
                            for kk, vv in snaps.items():
                                if str(kk).strip().upper() == sk:
                                    val = vv
                                    break
                        if val is not None:
                            out[sk] = val
                    except Exception:
                        continue
            except Exception:
                for sym in part:
                    try:
                        snaps = self.data_client.get_stock_snapshot(StockSnapshotRequest(symbol_or_symbols=sym))
                        if not isinstance(snaps, dict):
                            continue
                        sk = sym.upper()
                        val = snaps.get(sk)
                        if val is None and len(snaps) == 1:
                            val = next(iter(snaps.values()))
                        if val is not None:
                            out[sk] = val
                    except Exception:
                        continue
        return out

    def _row_from_stock_snapshot(self, sym: str, snap: Any, name: Optional[str], exchange: Optional[str]) -> dict[str, Any]:
        last = self._snapshot_last(snap)
        prev_close = None
        if snap.previous_daily_bar and snap.previous_daily_bar.close is not None:
            prev_close = float(snap.previous_daily_bar.close)
        o = h = l = c = vol = None
        if snap.daily_bar:
            db = snap.daily_bar
            o, h, l, c = float(db.open), float(db.high), float(db.low), float(db.close)
            vol = float(db.volume) if db.volume is not None else None

        change_pct = None
        if last is not None and prev_close is not None and prev_close > 0:
            change_pct = (last - prev_close) / prev_close * 100.0

        return {
            "symbol": sym,
            "name": name,
            "exchange": exchange,
            "last": last,
            "prev_close": prev_close,
            "change_pct": change_pct,
            "open": o,
            "high": h,
            "low": l,
            "close": c,
            "volume": vol,
        }

    def _snapshot_last(self, s: Any) -> Optional[float]:
        if s.latest_trade and s.latest_trade.price is not None:
            return float(s.latest_trade.price)
        if s.daily_bar and s.daily_bar.close is not None:
            return float(s.daily_bar.close)
        bq = s.latest_quote
        if bq and bq.bid_price and bq.ask_price:
            return (float(bq.bid_price) + float(bq.ask_price)) / 2.0
        return None

    def _resolve_screener_universe(self, body: ScreenerRequest) -> tuple[list[str], dict[str, dict[str, Optional[str]]]]:
        max_scan = max(10, min(int(body.max_scan), 1500))
        meta: dict[str, dict[str, Optional[str]]] = {}
        ex_needle = body.exchange.strip().upper() if body.exchange else None

        if body.symbols:
            out: list[str] = []
            for raw in body.symbols:
                s = str(raw).upper().strip()
                if not s or is_option_symbol(s):
                    continue
                if s in meta:
                    continue
                meta[s] = {"name": None, "exchange": None}
                out.append(s)
                if len(out) >= max_scan:
                    break
            return out, meta

        uni = (body.universe or "liquid").strip().lower()
        if uni == "liquid":
            syms = list(LIQUID_UNIVERSE)[:max_scan]
            for s in syms:
                meta[s] = {"name": None, "exchange": None}
            return syms, meta

        if uni != "tradable":
            raise HTTPException(status_code=400, detail="universe must be liquid, tradable, or pass symbols[]")

        req = GetAssetsRequest(status=AssetStatus.ACTIVE, asset_class=AssetClass.US_EQUITY)
        assets = self.trading_client.get_all_assets(req)
        picked: list[tuple[str, str, str]] = []
        for a in assets:
            if not getattr(a, "tradable", False):
                continue
            sym = str(a.symbol).upper().strip()
            if not sym or is_option_symbol(sym):
                continue
            ex = str(a.exchange) if getattr(a, "exchange", None) is not None else ""
            nm = str(a.name) if getattr(a, "name", None) else ""
            if ex_needle and ex_needle not in ex.upper():
                continue
            picked.append((sym, ex, nm))
        picked.sort(key=lambda t: t[0])
        picked = picked[:max_scan]
        syms: list[str] = []
        for sym, ex, nm in picked:
            syms.append(sym)
            meta[sym] = {"name": nm or None, "exchange": ex or None}
        return syms, meta

    def _screener_needs_fmp(self, body: ScreenerRequest) -> bool:
        if (body.sector or "").strip():
            return True
        if any(
            [
                body.min_market_cap is not None, body.max_market_cap is not None,
                body.min_pe is not None, body.max_pe is not None,
                body.min_peg is not None, body.max_peg is not None,
                body.min_roe is not None, body.max_roe is not None,
                body.min_dividend_yield is not None, body.max_dividend_yield is not None,
                body.min_beta is not None, body.max_beta is not None,
                body.min_eps_growth is not None, body.max_eps_growth is not None,
                body.min_revenue_growth is not None, body.max_revenue_growth is not None,
            ]
        ):
            return True
        sk = (body.sort or "").strip().lower()
        return sk in {"market_cap", "pe", "beta"}

    def _screener_needs_growth_fetch(self, body: ScreenerRequest) -> bool:
        return any(
            [
                body.min_eps_growth is not None, body.max_eps_growth is not None,
                body.min_revenue_growth is not None, body.max_revenue_growth is not None,
            ]
        )

    def _screener_needs_key_metrics(self, body: ScreenerRequest) -> bool:
        if self._screener_needs_growth_fetch(body):
            return True
        return any(
            [
                body.min_peg is not None, body.max_peg is not None,
                body.min_roe is not None, body.max_roe is not None,
                body.min_dividend_yield is not None, body.max_dividend_yield is not None,
            ]
        )

    def _merge_fmp_into_row(self, row: dict[str, Any], qp: dict[str, Any], km: dict[str, Any], gr: dict[str, Any]) -> None:
        sym = (row.get("symbol") or "").upper()
        base = {**(qp.get(sym) or {}), **(km.get(sym) or {}), **(gr.get(sym) or {})}
        for k, v in base.items():
            if v is None:
                continue
            if isinstance(v, str) and not v.strip():
                continue
            row[k] = v

    def _passes_fundamental_filters(self, row: dict[str, Any], body: ScreenerRequest) -> bool:
        filters = [
            ("fund_pe", body.min_pe, lambda v, f: float(v) >= f),
            ("fund_pe", body.max_pe, lambda v, f: float(v) <= f),
            ("fund_market_cap", body.min_market_cap, lambda v, f: float(v) >= f),
            ("fund_market_cap", body.max_market_cap, lambda v, f: float(v) <= f),
            ("fund_peg", body.min_peg, lambda v, f: float(v) >= f),
            ("fund_peg", body.max_peg, lambda v, f: float(v) <= f),
            ("fund_roe", body.min_roe, lambda v, f: float(v) >= f),
            ("fund_roe", body.max_roe, lambda v, f: float(v) <= f),
            ("fund_div_yield", body.min_dividend_yield, lambda v, f: float(v) >= f),
            ("fund_div_yield", body.max_dividend_yield, lambda v, f: float(v) <= f),
            ("fund_beta", body.min_beta, lambda v, f: float(v) >= f),
            ("fund_beta", body.max_beta, lambda v, f: float(v) <= f),
            ("fund_eps_growth", body.min_eps_growth, lambda v, f: float(v) >= f),
            ("fund_eps_growth", body.max_eps_growth, lambda v, f: float(v) <= f),
            ("fund_rev_growth", body.min_revenue_growth, lambda v, f: float(v) >= f),
            ("fund_rev_growth", body.max_revenue_growth, lambda v, f: float(v) <= f),
        ]
        for field, filter_val, comp in filters:
            if filter_val is not None:
                v = row.get(field)
                if v is None or not comp(v, filter_val):
                    return False
        
        sec_needle = (body.sector or "").strip()
        if sec_needle:
            sec = (row.get("fund_sector") or "").strip().lower()
            if sec != sec_needle.lower():
                return False
        return True

    def _fmp_safe_float(self, v: Any) -> Optional[float]:
        if v is None:
            return None
        try:
            x = float(v)
            if x != x:
                return None
            return x
        except (TypeError, ValueError):
            return None

    def _fmp_normalize_pctish(self, v: Optional[float]) -> Optional[float]:
        if v is None:
            return None
        if abs(v) <= 1.0:
            return v * 100.0
        return v

    def _fmp_quote_and_profile(self, symbols: list[str], api_key: str) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        if not symbols or not api_key:
            return out
        chunk = 100
        with httpx.Client(timeout=45.0) as client:
            for i in range(0, len(symbols), chunk):
                part = [str(s).upper().strip() for s in symbols[i : i + chunk] if s]
                if not part:
                    continue
                sym_csv = ",".join(part)
                quotes: list[Any] = []
                profiles: list[Any] = []
                try:
                    rq = client.get(f"{FMP_V3}/quote/{sym_csv}", params={"apikey": api_key})
                    if rq.status_code == 200:
                        j = rq.json()
                        if isinstance(j, list):
                            quotes = j
                except Exception:
                    pass
                try:
                    rp = client.get(f"{FMP_V3}/profile/{sym_csv}", params={"apikey": api_key})
                    if rp.status_code == 200:
                        j = rp.json()
                        if isinstance(j, list):
                            profiles = j
                except Exception:
                    pass
                pmap = {(p.get("symbol") or "").upper(): p for p in profiles if isinstance(p, dict)}
                for q in quotes:
                    if not isinstance(q, dict):
                        continue
                    sym = (q.get("symbol") or "").upper()
                    if not sym:
                        continue
                    pr = pmap.get(sym, {})
                    mc = self._fmp_safe_float(q.get("marketCap")) or self._fmp_safe_float(pr.get("mktCap"))
                    out[sym] = {
                        "fund_market_cap": mc,
                        "fund_pe": self._fmp_safe_float(q.get("pe")),
                        "fund_eps": self._fmp_safe_float(q.get("eps")),
                        "fund_beta": self._fmp_safe_float(pr.get("beta")),
                        "fund_sector": (pr.get("sector") or "").strip(),
                        "fund_industry": (pr.get("industry") or "").strip(),
                    }
                    nm = pr.get("companyName") or q.get("name")
                    if nm:
                        out[sym]["name"] = str(nm)
        return out

    def _fmp_key_metrics_ttm_one(self, sym: str, api_key: str) -> tuple[str, dict[str, Any]]:
        sym = sym.upper().strip()
        extra: dict[str, Any] = {}
        try:
            with httpx.Client(timeout=22.0) as client:
                r = client.get(f"{FMP_V3}/key-metrics-ttm/{sym}", params={"apikey": api_key})
                if r.status_code != 200:
                    return sym, extra
                data = r.json()
                if not isinstance(data, list) or not data:
                    return sym, extra
                d = data[0]
                if not isinstance(d, dict):
                    return sym, extra
                div = d.get("dividendYieldTTM") or d.get("dividendYield")
                div_f = self._fmp_safe_float(div)
                div_pct = self._fmp_normalize_pctish(div_f) if div_f is not None else None
                roe = self._fmp_safe_float(d.get("roeTTM") or d.get("roe"))
                roe_pct = self._fmp_normalize_pctish(roe) if roe is not None else None
                extra["fund_peg"] = self._fmp_safe_float(d.get("pegRatioTTM") or d.get("pegRatio"))
                extra["fund_roe"] = roe_pct
                extra["fund_div_yield"] = div_pct
                pe_k = self._fmp_safe_float(d.get("peRatioTTM") or d.get("peRatio"))
                if pe_k is not None:
                    extra["fund_pe"] = pe_k
                m_k = self._fmp_safe_float(d.get("marketCapTTM") or d.get("marketCap"))
                if m_k is not None:
                    extra["fund_market_cap"] = m_k
                rg = self._fmp_safe_float(d.get("revenueGrowth"))
                if rg is not None:
                    extra["fund_rev_growth"] = self._fmp_normalize_pctish(rg)
        except Exception:
            pass
        return sym, extra

    def _fmp_key_metrics_parallel(self, symbols: list[str], api_key: str, workers: int = 14) -> dict[str, dict[str, Any]]:
        if not symbols or not api_key:
            return {}
        merged: dict[str, dict[str, Any]] = {}
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = {ex.submit(self._fmp_key_metrics_ttm_one, s, api_key): s for s in symbols}
            for fut in as_completed(futures):
                sym, extra = fut.result()
                merged[sym.upper()] = extra
        return merged

    def _fmp_financial_growth_one(self, sym: str, api_key: str) -> tuple[str, dict[str, Any]]:
        sym = sym.upper().strip()
        out: dict[str, Any] = {}
        try:
            with httpx.Client(timeout=22.0) as client:
                r = client.get(f"{FMP_V3}/financial-growth/{sym}", params={"apikey": api_key, "limit": 1})
                if r.status_code != 200:
                    return sym, out
                data = r.json()
                if not isinstance(data, list) or not data:
                    return sym, out
                row = data[0]
                if not isinstance(row, dict):
                    return sym, out
                eg = self._fmp_safe_float(row.get("epsgrowth") or row.get("epsGrowth") or row.get("EPSGrowth"))
                rg = self._fmp_safe_float(row.get("revenueGrowth"))
                if eg is not None:
                    out["fund_eps_growth"] = self._fmp_normalize_pctish(eg)
                if rg is not None:
                    out["fund_rev_growth"] = self._fmp_normalize_pctish(rg)
        except Exception:
            pass
        return sym, out

    def _fmp_financial_growth_parallel(self, symbols: list[str], api_key: str, workers: int = 12) -> dict[str, dict[str, Any]]:
        if not symbols or not api_key:
            return {}
        merged: dict[str, dict[str, Any]] = {}
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = {ex.submit(self._fmp_financial_growth_one, s, api_key): s for s in symbols}
            for fut in as_completed(futures):
                sym, extra = fut.result()
                if extra:
                    merged[sym.upper()] = extra
        return merged

    def _bar_list_for_symbol(self, bars: Any, sym: str) -> list:
        if hasattr(bars, "data") and isinstance(getattr(bars, "data", None), dict):
            d = bars.data
            if sym in d:
                return d[sym]
            for k, v in d.items():
                if str(k).strip().upper() == sym:
                    return v
            return []
        try:
            return bars[sym]
        except (KeyError, TypeError):
            return []

    def _parse_iso_dt(self, value: str) -> datetime:
        v = value.strip()
        if v.endswith("Z"):
            v = v[:-1] + "+00:00"
        dt = datetime.fromisoformat(v)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
