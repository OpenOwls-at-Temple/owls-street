import pytest
import pandas as pd
import numpy as np
from src.indicators import (
    sma, ema, rsi, macd, bollinger_bands,
    cross_above, cross_below, evaluate_indicator_rule
)

@pytest.fixture
def sample_series():
    # Simple linear price series
    return pd.Series([10.0, 11.0, 12.0, 13.0, 14.0, 15.0])

@pytest.fixture
def flat_df():
    # Flat price DataFrame
    dates = pd.date_range(start="2026-06-01 00:00:00", periods=50, freq="15Min")
    return pd.DataFrame({
        "open": [100.0] * 50,
        "high": [100.0] * 50,
        "low": [100.0] * 50,
        "close": [100.0] * 50,
        "volume": [1000] * 50
    }, index=dates)

def test_sma(sample_series):
    result = sma(sample_series, 3)
    # First two values should be NaN
    assert pd.isna(result.iloc[0])
    assert pd.isna(result.iloc[1])
    # Third value: (10 + 11 + 12) / 3 = 11.0
    assert result.iloc[2] == 11.0
    # Last value: (13 + 14 + 15) / 3 = 14.0
    assert result.iloc[5] == 14.0

def test_ema(sample_series):
    result = ema(sample_series, 3)
    # EMA initialized with first value, and calculated using alpha = 2 / (period + 1)
    # For period=3, alpha = 2 / 4 = 0.5
    # t0: 10
    # t1: 0.5 * 11 + 0.5 * 10 = 10.5
    # t2: 0.5 * 12 + 0.5 * 10.5 = 11.25
    assert result.iloc[0] == 10.0
    assert result.iloc[1] == 10.5
    assert result.iloc[2] == 11.25

def test_rsi_flat(flat_df):
    result = rsi(flat_df["close"], 14)
    # Flat series should yield RSI of NaN or 50.0 (divided by zero check)
    # In Wilder's, flat series means avg_gain = 0 and avg_loss = 0
    # division will yield nan
    assert pd.isna(result.iloc[-1]) or np.isnan(result.iloc[-1])

def test_rsi_trending():
    # Strong upward trend should lead to high RSI
    trend = pd.Series([10.0 + i for i in range(30)])
    result = rsi(trend, 14)
    # Last value should be close to 100
    assert result.iloc[-1] > 90.0

def test_macd(flat_df):
    m_line, s_line, hist = macd(flat_df["close"], 12, 26, 9)
    # Since prices are flat, MACD line and signal should converge to 0
    assert abs(m_line.iloc[-1]) < 0.001
    assert abs(s_line.iloc[-1]) < 0.001
    assert abs(hist.iloc[-1]) < 0.001

def test_bollinger_bands(flat_df):
    upper, middle, lower = bollinger_bands(flat_df["close"], 20, 2.0)
    # Flat price means middle band = close, upper = close, lower = close (std=0)
    assert middle.iloc[-1] == 100.0
    assert upper.iloc[-1] == 100.0
    assert lower.iloc[-1] == 100.0

def test_crossovers():
    a = pd.Series([10.0, 11.0, 12.0, 13.0, 11.0])
    b = pd.Series([12.0, 12.0, 12.0, 12.0, 12.0])
    
    # cross_above: True only at index 3 (when 12->13 and b remains 12)
    c_above = cross_above(a, b)
    assert not c_above.iloc[0]
    assert not c_above.iloc[1]
    assert not c_above.iloc[2]
    assert c_above.iloc[3]
    assert not c_above.iloc[4]

    # cross_below: True only at index 4 (when 13->11 and b remains 12)
    c_below = cross_below(a, b)
    assert not c_below.iloc[3]
    assert c_below.iloc[4]

def test_evaluate_rule_rsi_oversold():
    # Make a series where RSI dips below 30
    # Start high, then plunge
    prices = [100.0] * 20 + [90.0, 80.0, 70.0, 60.0, 50.0, 40.0, 30.0, 20.0, 10.0]
    dates = pd.date_range(start="2026-06-01 00:00:00", periods=len(prices), freq="15Min")
    df = pd.DataFrame({"close": prices}, index=dates)

    triggered, value, meta = evaluate_indicator_rule(
        df=df,
        indicator="RSI",
        params={"period": 14},
        operator="less_than",
        value=30.0
    )
    
    assert triggered
    assert value < 30.0
    assert "RSI(14)" in meta

def test_evaluate_rule_sma_cross():
    # Fast SMA crosses above Slow SMA on the very last bar
    # 50 flat bars of 10.0, then a jump to 20.0 on the 51st bar
    prices = [10.0] * 50 + [20.0]
    dates = pd.date_range(start="2026-06-01 00:00:00", periods=len(prices), freq="15Min")
    df = pd.DataFrame({"close": prices}, index=dates)

    # Let's check SMA_Cross: fast=3, slow=5
    triggered, value, meta = evaluate_indicator_rule(
        df=df,
        indicator="SMA_Cross",
        params={"fast_period": 3, "slow_period": 5},
        operator="cross_above"
    )
    # The crossover occurs exactly on the final bar (t=50)
    assert triggered
