import logging
from typing import Dict, Any, Tuple, Union, Optional
import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)

def sma(series: pd.Series, period: int) -> pd.Series:
    """Computes Simple Moving Average."""
    return series.rolling(window=period).mean()

def ema(series: pd.Series, period: int) -> pd.Series:
    """Computes Exponential Moving Average."""
    return series.ewm(span=period, adjust=False).mean()

def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """
    Computes Relative Strength Index using Wilder's smoothing technique.
    This is mathematically equivalent to an EMA with alpha = 1 / period
    initialized with a simple moving average of the first 'period' values.
    """
    if len(series) < period + 1:
        return pd.Series(np.nan, index=series.index)

    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    # First average gain/loss are standard simple moving averages
    avg_gain = gain.rolling(window=period, min_periods=period).mean()
    avg_loss = loss.rolling(window=period, min_periods=period).mean()

    # Subsequent values use Wilder's exponential smoothing
    avg_gain = avg_gain.ewm(alpha=1/period, adjust=False).mean()
    avg_loss = avg_loss.ewm(alpha=1/period, adjust=False).mean()

    rs = avg_gain / avg_loss
    # Handle division by zero
    rsi_series = 100 - (100 / (1 + rs))
    return rsi_series

def macd(series: pd.Series, fast_period: int = 12, slow_period: int = 26, signal_period: int = 9) -> Tuple[pd.Series, pd.Series, pd.Series]:
    """Computes MACD, Signal line, and Histogram."""
    fast_ema = ema(series, fast_period)
    slow_ema = ema(series, slow_period)
    macd_line = fast_ema - slow_ema
    signal_line = ema(macd_line, signal_period)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram

def bollinger_bands(series: pd.Series, period: int = 20, std_dev: float = 2.0) -> Tuple[pd.Series, pd.Series, pd.Series]:
    """Computes Bollinger Bands: Upper, Middle, Lower."""
    middle_band = sma(series, period)
    std = series.rolling(window=period).std()
    upper_band = middle_band + (std * std_dev)
    lower_band = middle_band - (std * std_dev)
    return upper_band, middle_band, lower_band

def cross_above(series_a: pd.Series, series_b: Union[pd.Series, float, int]) -> pd.Series:
    """Returns True for indices where series_a crosses above series_b."""
    if not isinstance(series_b, pd.Series):
        series_b = pd.Series(series_b, index=series_a.index)
    return (series_a.shift(1) <= series_b.shift(1)) & (series_a > series_b)

def cross_below(series_a: pd.Series, series_b: Union[pd.Series, float, int]) -> pd.Series:
    """Returns True for indices where series_a crosses below series_b."""
    if not isinstance(series_b, pd.Series):
        series_b = pd.Series(series_b, index=series_a.index)
    return (series_a.shift(1) >= series_b.shift(1)) & (series_a < series_b)

def evaluate_indicator_rule(df: pd.DataFrame, indicator: str, params: Dict[str, Any], operator: str, value: Optional[float] = None) -> Tuple[bool, float, Dict[str, Any]]:
    """
    Computes an indicator and evaluates the rule's trigger condition on the latest bar.
    
    Returns:
        (is_triggered, actual_value, metadata)
    """
    if df.empty or len(df) < 2:
        return False, 0.0, {"error": "Not enough bars to calculate indicators"}

    close_series = df["close"]
    
    # 1. Compute indicator
    if indicator == "RSI":
        period = int(params.get("period", 14))
        ind_series = rsi(close_series, period)
        metric_name = f"RSI({period})"
        metadata = {metric_name: float(ind_series.iloc[-1])}
        series_a = ind_series
        series_b = value

    elif indicator == "SMA":
        period = int(params.get("period", 20))
        ind_series = sma(close_series, period)
        metric_name = f"SMA({period})"
        metadata = {metric_name: float(ind_series.iloc[-1]), "price": float(close_series.iloc[-1])}
        # Comparison is price vs SMA
        series_a = close_series
        series_b = ind_series

    elif indicator == "EMA":
        period = int(params.get("period", 20))
        ind_series = ema(close_series, period)
        metric_name = f"EMA({period})"
        metadata = {metric_name: float(ind_series.iloc[-1]), "price": float(close_series.iloc[-1])}
        # Comparison is price vs EMA
        series_a = close_series
        series_b = ind_series

    elif indicator == "SMA_Cross":
        fast_p = int(params.get("fast_period", 50))
        slow_p = int(params.get("slow_period", 200))
        fast_sma = sma(close_series, fast_p)
        slow_sma = sma(close_series, slow_p)
        metadata = {
            f"SMA({fast_p})": float(fast_sma.iloc[-1]) if not pd.isna(fast_sma.iloc[-1]) else None,
            f"SMA({slow_p})": float(slow_sma.iloc[-1]) if not pd.isna(slow_sma.iloc[-1]) else None
        }
        series_a = fast_sma
        series_b = slow_sma

    elif indicator == "EMA_Cross":
        fast_p = int(params.get("fast_period", 9))
        slow_p = int(params.get("slow_period", 21))
        fast_ema = ema(close_series, fast_p)
        slow_ema = ema(close_series, slow_p)
        metadata = {
            f"EMA({fast_p})": float(fast_ema.iloc[-1]),
            f"EMA({slow_p})": float(slow_ema.iloc[-1])
        }
        series_a = fast_ema
        series_b = slow_ema

    elif indicator == "MACD":
        fast_p = int(params.get("fast_period", 12))
        slow_p = int(params.get("slow_period", 26))
        signal_p = int(params.get("signal_period", 9))
        macd_line, signal_line, hist = macd(close_series, fast_p, slow_p, signal_p)
        metadata = {
            "macd": float(macd_line.iloc[-1]),
            "signal": float(signal_line.iloc[-1]),
            "histogram": float(hist.iloc[-1])
        }
        # For plain MACD, check MACD line vs user value (or 0)
        series_a = macd_line
        series_b = value if value is not None else 0.0

    elif indicator == "MACD_Cross":
        fast_p = int(params.get("fast_period", 12))
        slow_p = int(params.get("slow_period", 26))
        signal_p = int(params.get("signal_period", 9))
        macd_line, signal_line, hist = macd(close_series, fast_p, slow_p, signal_p)
        metadata = {
            "macd": float(macd_line.iloc[-1]),
            "signal": float(signal_line.iloc[-1]),
            "histogram": float(hist.iloc[-1])
        }
        # Cross comparison is MACD line vs Signal line
        series_a = macd_line
        series_b = signal_line

    elif indicator == "Bollinger_Bands":
        period = int(params.get("period", 20))
        std_dev = float(params.get("std_dev", 2.0))
        upper, middle, lower = bollinger_bands(close_series, period, std_dev)
        metadata = {
            "upper": float(upper.iloc[-1]) if not pd.isna(upper.iloc[-1]) else None,
            "middle": float(middle.iloc[-1]) if not pd.isna(middle.iloc[-1]) else None,
            "lower": float(lower.iloc[-1]) if not pd.isna(lower.iloc[-1]) else None,
            "price": float(close_series.iloc[-1])
        }
        # In Bollinger Bands indicator rule:
        # If value is 1.0 (Upper), check price vs upper
        # If value is -1.0 (Lower), check price vs lower
        # If value is 0.0 (Middle), check price vs middle
        target_band = value if value is not None else 1.0
        if target_band == 1.0:
            series_a = close_series
            series_b = upper
        elif target_band == -1.0:
            series_a = close_series
            series_b = lower
        else:
            series_a = close_series
            series_b = middle
    else:
        raise ValueError(f"Unknown indicator: {indicator}")

    # Ensure we don't evaluate on NaNs
    if pd.isna(series_a.iloc[-1]) or (isinstance(series_b, pd.Series) and pd.isna(series_b.iloc[-1])):
        return False, 0.0, {**metadata, "warning": "Indicator returned NaN (insufficient history)"}

    # 2. Evaluate condition
    triggered = False
    if operator == "less_than":
        triggered = bool(series_a.iloc[-1] < (series_b.iloc[-1] if isinstance(series_b, pd.Series) else series_b))
    elif operator == "greater_than":
        triggered = bool(series_a.iloc[-1] > (series_b.iloc[-1] if isinstance(series_b, pd.Series) else series_b))
    elif operator == "cross_above":
        # Check cross above on the last bar
        cross_series = cross_above(series_a, series_b)
        triggered = bool(cross_series.iloc[-1])
    elif operator == "cross_below":
        # Check cross below on the last bar
        cross_series = cross_below(series_a, series_b)
        triggered = bool(cross_series.iloc[-1])

    actual_value = float(series_a.iloc[-1])
    return triggered, actual_value, metadata
