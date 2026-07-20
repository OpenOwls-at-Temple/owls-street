# Domain Knowledge Spec

This document details the financial concepts, indicator calculations, and business rules implemented within the Owl Street ecosystem.

## Technical Indicators & Formulas

All mathematical computations are calculated in Python (`owl-street-pulse/src/indicators.py`):

1. **SMA (Simple Moving Average)**: Standard rolling mean of closing prices over a specified period.
2. **EMA (Exponential Moving Average)**: Weighted moving average that gives higher weight to recent prices.
3. **RSI (Relative Strength Index)**: Uses Wilder's smoothing method for gains and losses over a specified period. Standard overbought/oversold limits: `> 70` (overbought) and `< 30` (oversold).
4. **MACD (Moving Average Convergence Divergence)**:
   * **MACD Line**: Fast EMA (default 12) minus Slow EMA (default 26).
   * **Signal Line**: EMA of the MACD Line (default 9).
   * **Histogram**: MACD Line minus Signal Line.
5. **Bollinger Bands**:
   * **Middle Band**: Simple Moving Average of price (default 20).
   * **Upper Band**: Middle Band + (N * standard deviation of price).
   * **Lower Band**: Middle Band - (N * standard deviation of price).

## Indicator Crossovers
* **`cross_above`**: Triggered when the current value of Indicator A is greater than Indicator B (or a static threshold), and the *previous* value of Indicator A was less than or equal to Indicator B.
* **`cross_below`**: Triggered when the current value of Indicator A is less than Indicator B (or a static threshold), and the *previous* value of Indicator A was greater than or equal to Indicator B.

## Option Chain Matrix Metrics
* **Implied Volatility (IV%)**: Market's forecast of a likely movement in the security's price.
* **Greeks**:
  * **Delta**: Sensitivity of option price to underlying price change.
  * **Gamma**: Rate of change of Delta.
  * **Theta**: Time decay of the option value.
  * **Vega**: Sensitivity of option price to implied volatility change.

## Alert State & Deduplication Constraints
To avoid flooding Slack/Discord/Telegram with spam alerts during volatile market conditions:
1. **One Alert Per Candle**: When an alert rule fires (e.g. AAPL RSI oversold on 15Min timeframe), a record is written to `alerts.db` containing `(rule_id, timestamp_of_candle_start)`. Even if the current candle is open and recalculating, the engine ensures only one message is sent for that specific candle bar.
2. **Cooldown Intervals**: Rules specify `cooldown_seconds`. A rule will not fire again until the time elapsed since its last trigger exceeds this value.
