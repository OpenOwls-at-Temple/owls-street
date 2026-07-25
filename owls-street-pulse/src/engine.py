import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Tuple, Any
import pandas as pd

from src.config import AppConfig, MonitorConfig, RuleConfig
from src.alpaca import AlpacaClient
from src.indicators import evaluate_indicator_rule
from src.database import StateDatabase
from src.notifier import AlertNotifier

logger = logging.getLogger(__name__)

def calculate_lookback_start(timeframe: str, max_period: int) -> datetime:
    """
    Calculates how far back we need to fetch data to have enough bars
    to calculate indicators including a warm-up buffer.
    """
    # Safe buffer of 100 bars to ensure EMA/RSI calculations are stable and accurate
    total_bars = max_period + 100
    now = datetime.now(timezone.utc)
    
    if timeframe == "1Min":
        return now - timedelta(minutes=total_bars)
    elif timeframe == "5Min":
        return now - timedelta(minutes=total_bars * 5)
    elif timeframe == "15Min":
        return now - timedelta(minutes=total_bars * 15)
    elif timeframe == "1Hour":
        return now - timedelta(hours=total_bars)
    elif timeframe == "1Day":
        # 1.5x multiplier to account for weekends/holidays in trading days
        return now - timedelta(days=int(total_bars * 1.5))
    
    return now - timedelta(days=30)  # Default fallback

class AlertEngine:
    def __init__(self, config: AppConfig, db_path: str = "data/alerts.db"):
        self.config = config
        self.client = AlpacaClient(
            api_key=config.alpaca.api_key,
            api_secret=config.alpaca.api_secret,
            data_base_url=config.alpaca.data_base_url
        )
        self.db = StateDatabase(db_path=db_path)
        self.notifier = AlertNotifier(config.notifiers)

    def run_checks(self):
        """Executes a single pass over all monitored symbols and evaluated rules."""
        logger.info("Starting technical indicators check cycle...")
        
        # Group monitors/rules by (asset_class, timeframe) to batch requests to Alpaca
        # Format: (asset_class, timeframe) -> List[Tuple[symbol, rule_config]]
        groups: Dict[Tuple[str, str], List[Tuple[str, RuleConfig]]] = {}
        
        for monitor in self.config.monitors:
            asset_class = monitor.asset_class
            symbol = monitor.symbol
            for rule in monitor.rules:
                key = (asset_class, rule.timeframe)
                if key not in groups:
                    groups[key] = []
                groups[key].append((symbol, rule))

        # Process each group
        for (asset_class, timeframe), items in groups.items():
            logger.info(f"Processing group: Asset Class={asset_class}, Timeframe={timeframe}")
            
            # Find all unique symbols in this group
            symbols = list(set([item[0] for item in items]))
            
            # Find the maximum indicator period in this group to fetch enough history
            max_period = 14  # Default baseline
            for symbol, rule in items:
                # Look for standard period params
                periods = [
                    rule.params.get("period"),
                    rule.params.get("slow_period"),
                    rule.params.get("fast_period")
                ]
                for p in periods:
                    if p is not None and int(p) > max_period:
                        max_period = int(p)

            # Determine lookback start time
            start_time = calculate_lookback_start(timeframe, max_period)
            
            # Fetch bars for all symbols in this group
            try:
                bars_dict = self.client.get_historical_bars(
                    symbols=symbols,
                    asset_class=asset_class,
                    timeframe=timeframe,
                    start_time=start_time
                )
            except Exception as e:
                logger.error(f"Failed to fetch historical bars for {symbols} ({timeframe}): {e}")
                continue

            # Evaluate each rule for this group
            for symbol, rule in items:
                df = bars_dict.get(symbol)
                if df is None or df.empty:
                    logger.warning(f"No data available for symbol '{symbol}'. Skipping rule '{rule.name}'.")
                    continue

                try:
                    # Evaluate the technical indicator rule
                    triggered, actual_value, metadata = evaluate_indicator_rule(
                        df=df,
                        indicator=rule.indicator,
                        params=rule.params,
                        operator=rule.condition.operator,
                        value=rule.condition.value
                    )
                    
                    if triggered:
                        # Latest bar's timestamp is the last index
                        latest_bar_time = df.index[-1]
                        bar_time_str = latest_bar_time.strftime("%Y-%m-%d %H:%M:%S UTC")
                        
                        # Verify state: check if already sent for this bar or within cooldown
                        if self.db.should_trigger(rule.id, bar_time_str, rule.cooldown_seconds):
                            # Dispatch alerts
                            self.notifier.send_alert(
                                symbol=symbol,
                                rule_name=rule.name,
                                timeframe=rule.timeframe,
                                indicator=rule.indicator,
                                value=actual_value,
                                bar_time=bar_time_str,
                                operator=rule.condition.operator,
                                condition_val=rule.condition.value,
                                metadata=metadata
                            )
                            
                            # Record state to SQLite database
                            self.db.update_trigger_state(
                                rule_id=rule.id,
                                symbol=symbol,
                                bar_time=bar_time_str,
                                value=actual_value
                            )
                    else:
                        logger.debug(f"Rule '{rule.name}' for {symbol} not triggered. Value={actual_value:.4f}")

                except Exception as e:
                    logger.error(f"Error evaluating rule '{rule.name}' ({rule.id}) for {symbol}: {e}", exc_info=True)

        logger.info("Check cycle completed.")
