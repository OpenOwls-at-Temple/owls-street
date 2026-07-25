# Owls Street Stock Screener 🔍📊

The **Stock Screener** is a high-performance filtering tool built into the [owls-street-view](../owls-street-view) dashboard. It allows you to filter and sort through thousands of US equities based on live technicals, daily pricing, volume snapshots, and institutional-grade company fundamentals.

---

## 🚀 Key Features

- **Dual API Orchestration**: Seamlessly combines real-time pricing and volume snapshots from the **Alpaca Market Data API** with comprehensive fundamental profiles and financial ratios from **Financial Modeling Prep (FMP)**.
- **Multiple Market Universes**: Choose between:
  1. `All US stocks`: Scans all tradable US equities.
  2. `Liquid + popular ETFs`: Focuses on highly liquid tickers and index benchmarks.
  3. `Watchlist`: Restricts scanners to your custom watchlist symbols.
  4. `Index / benchmark ETFs`: Restricts scans to broad index ETFs (S&P 500, Nasdaq-100, Russell 2000, Dow Jones, etc.).
- **TradingView-Inspired Interface**: Advanced filter popovers that support multiple concurrent dropdown constraints, sorting by various fields, and flexible page row limits.

---

## 🛠️ Configuration & API Dependencies

The screener is designed to run in a dual mode depending on your active API keys:

1. **Alpaca Only (Standard Mode)**:
   Filters that rely purely on live pricing, volume, and percentage change (Market Data category) will function. Fundamental-based options are disabled.
2. **Alpaca + Financial Modeling Prep (FMP) (Full Mode)**:
   Provides access to financial metrics, valuation, growth, margins, and dividend yields.

To enable **Full Mode**, ensure your `FMP_API_KEY` is specified in your `owls-street-view/.env` file:
```env
# owls-street-view/.env
FMP_API_KEY=your_fmp_api_key_here
```

> [!WARNING]
> If you apply fundamental filters (e.g. P/E ratio, Market Cap, Beta) or attempt to sort by a fundamental column without setting a valid `FMP_API_KEY`, the server will return a `400 Bad Request` HTTP error.

---

## 📋 Available Filters

The screener organizes dropdown options into logical categories based on modern trading configurations:

| Category | Filter Name | Key Field | Description |
|---|---|---|---|
| **Security Info** | Region | `region` | Restrict search to specific countries (default US). |
| | Watchlist | `watchlist_tag` | Filter to find symbols matching or excluded from watchlist. |
| | Index / ETF | `index_tag` | Filter by major indexes (e.g. S&P 500 ETFs, Nasdaq-100, Sector SPDRs). |
| | Sector | `sector` | Filter by market sectors (e.g. Technology, Healthcare, Financial Services). |
| | Exchange | `exchange` | Filter by listing exchange (NASDAQ, NYSE, AMEX, BATS). |
| | Analyst Rating | `analyst` | Buy/Hold/Sell consensus recommendations. |
| **Market Data** | Last Price | `price` | Filter by current trade price range (e.g. Under $5, $50 – $100, etc.). |
| | Open Price | `open_band` | Filter by the market session open price. |
| | Change % | `change_pct` | Positive, negative, or custom session percentage change thresholds. |
| | Share Volume | `volume` | Average/live share volume bounds. |
| | Dollar Volume | `dollar_vol` | Last price multiplied by daily share volume (liquidity gauge). |
| | Daily Range % | `day_range` | Daily high-to-low spread percentage. |
| **Technicals** | Beta | `beta` * | Sensitivity relative to the market index. |
| **Financials** | Market Cap | `market_cap` * | Company valuation tier (Mega, Large, Mid, Small, Micro). |
| | Recent Earnings | `earn_recent` * | Earnings announcements within a recent range (e.g. Last week, Last 30 days). |
| | Upcoming Earnings | `earn_up` * | Approaching quarterly or annual earnings announcements. |
| **Valuation** | P/E Ratio | `pe` * | Trailing Price-to-Earnings multiple. |
| | PEG Ratio | `peg` * | Price/Earnings-to-Growth ratio. |
| **Growth** | EPS Growth | `eps` * | Year-over-year earnings per share growth. |
| | Revenue Growth | `rev` * | Year-over-year sales/revenue growth. |
| **Margins** | ROE | `roe` * | Return on Equity percentage. |
| **Dividends** | Dividend Yield | `div` * | Annualized dividend payout yield percentage. |

*\* Requires FMP_API_KEY*

---

## ⚙️ Architecture & Technical Detail

### Backend Pipeline (`owls-street-view/src/alpaca_service.py` -> `run_screener`)
1. **Universe Resolution**: Translates the selected workspace scope into a list of candidate symbols.
2. **Batch Pricing Snapshot**: Pulls live market snapshots for all candidate symbols from Alpaca in a single optimized request.
3. **Market Filters Application**: Prunes tickers that do not meet standard price, volume, open, or range constraints.
4. **FMP Fundamentals Injection**: 
   - If fundamental filters are specified, the backend batches requests for company profiles, key metrics, and growth data.
   - Merges these dictionaries into the rows.
5. **Sorting & Pagination**: Sorts by your specified key (e.g. Market Cap or % Change) and returns the top matching records up to the request `limit`.

### Frontend Component (`owls-street-view/frontend/src/components/Screener.jsx`)
- Built as a responsive React table with virtualized inputs.
- Handles responsive column configurations (`Overview`, `Minimal`, `Extended`).
- Custom preset integrations: Quickly jump to `Top gainers`, `Top losers`, or `High volume`.
