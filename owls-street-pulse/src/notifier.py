import logging
import requests
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from src.config import NotifiersConfig

logger = logging.getLogger(__name__)

class AlertNotifier:
    def __init__(self, config: NotifiersConfig):
        self.config = config

    def _get_color(self, operator: str) -> int:
        """Helper to get a matching color for Discord embeds (green for buy, red for sell/caution)."""
        # Decimal color values: Green (#2E7D32) = 3046706, Red (#C62828) = 13002792, Blue (#5865F2) = 5793266
        if "less_than" in operator or "cross_below" in operator:
            # Often buying opportunities (oversold) or crossovers
            return 3046706
        elif "greater_than" in operator or "cross_above" in operator:
            # Often selling opportunities (overbought) or breakouts
            return 13002792
        return 5793266

    def send_alert(
        self,
        symbol: str,
        rule_name: str,
        timeframe: str,
        indicator: str,
        value: float,
        bar_time: str,
        operator: str,
        condition_val: Optional[float],
        metadata: Dict[str, Any]
    ):
        """Sends an alert to all enabled channels."""
        # Standardize representation of condition
        if condition_val is not None:
            op_sym = "<" if operator == "less_than" else ">" if operator == "greater_than" else "crosses above" if operator == "cross_above" else "crosses below"
            condition_str = f"{indicator} {op_sym} {condition_val}"
        else:
            op_sym = "crosses above" if operator == "cross_above" else "crosses below"
            condition_str = f"{indicator} {op_sym}"

        meta_lines = []
        for k, v in metadata.items():
            if v is not None:
                meta_lines.append(f"{k}: {v:.4f}" if isinstance(v, float) else f"{k}: {v}")
        meta_str = ", ".join(meta_lines)

        # 1. Console Notifier
        if self.config.console.enabled:
            self._send_to_console(symbol, rule_name, timeframe, condition_str, value, bar_time, meta_str)

        # 2. Discord Notifier
        if self.config.discord.enabled and self.config.discord.webhook_url:
            self._send_to_discord(symbol, rule_name, timeframe, condition_str, value, bar_time, meta_str, operator)

        # 3. Slack Notifier
        if self.config.slack.enabled and self.config.slack.webhook_url:
            self._send_to_slack(symbol, rule_name, timeframe, condition_str, value, bar_time, meta_str)

        # 4. Telegram Notifier
        if self.config.telegram.enabled and self.config.telegram.bot_token and self.config.telegram.chat_id:
            self._send_to_telegram(symbol, rule_name, timeframe, condition_str, value, bar_time, meta_str)

    def _send_to_console(
        self, symbol: str, rule_name: str, timeframe: str, condition_str: str,
        value: float, bar_time: str, meta_str: str
    ):
        logger.info(
            f"ALERT TRIGGERED: {symbol} | Rule: {rule_name} ({timeframe}) | "
            f"Condition: {condition_str} | Value: {value} | Bar Time: {bar_time} | Metrics: {meta_str}"
        )

    def _send_to_discord(
        self, symbol: str, rule_name: str, timeframe: str, condition_str: str,
        value: float, bar_time: str, meta_str: str, operator: str
    ):
        try:
            payload = {
                "username": "Owl Street Pulse",
                "avatar_url": "https://raw.githubusercontent.com/google/material-design-icons/master/png/action/trending_up/materialicons/48dp/2x/baseline_trending_up_black_48dp.png",
                "embeds": [
                    {
                        "title": f"🚨 ALERT TRIGGERED: {symbol}",
                        "description": f"**Rule:** {rule_name}\n**Condition:** `{condition_str}`",
                        "color": self._get_color(operator),
                        "fields": [
                            {"name": "Actual Value", "value": f"{value:.4f}", "inline": True},
                            {"name": "Timeframe", "value": timeframe, "inline": True},
                            {"name": "Bar Timestamp", "value": bar_time, "inline": False},
                            {"name": "Indicator Details", "value": meta_str if meta_str else "N/A", "inline": False}
                        ],
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }
                ]
            }
            response = requests.post(self.config.discord.webhook_url, json=payload, timeout=10)
            response.raise_for_status()
            logger.debug(f"Successfully sent Discord alert for {symbol}")
        except Exception as e:
            logger.error(f"Failed to send Discord alert for {symbol}: {e}")

    def _send_to_slack(
        self, symbol: str, rule_name: str, timeframe: str, condition_str: str,
        value: float, bar_time: str, meta_str: str
    ):
        try:
            payload = {
                "text": f"🚨 [Owl Street Pulse] Alert triggered for {symbol}: {condition_str}",
                "blocks": [
                    {
                        "type": "header",
                        "text": {
                            "type": "plain_text",
                            "text": f"🚨 Alert Triggered: {symbol}"
                        }
                    },
                    {
                        "type": "section",
                        "fields": [
                            {"type": "mrkdwn", "text": f"*Rule:*\n{rule_name}"},
                            {"type": "mrkdwn", "text": f"*Timeframe:*\n{timeframe}"},
                            {"type": "mrkdwn", "text": f"*Condition:*\n`{condition_str}`"},
                            {"type": "mrkdwn", "text": f"*Actual Value:*\n{value:.4f}"}
                        ]
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*Bar Timestamp:*\n{bar_time}\n*Details:*\n{meta_str}"
                        }
                    }
                ]
            }
            response = requests.post(self.config.slack.webhook_url, json=payload, timeout=10)
            response.raise_for_status()
            logger.debug(f"Successfully sent Slack alert for {symbol}")
        except Exception as e:
            logger.error(f"Failed to send Slack alert for {symbol}: {e}")

    def _send_to_telegram(
        self, symbol: str, rule_name: str, timeframe: str, condition_str: str,
        value: float, bar_time: str, meta_str: str
    ):
        try:
            text = (
                f"🚨 <b>Alert Triggered: {symbol}</b>\n"
                f"<b>Rule:</b> {rule_name}\n"
                f"<b>Condition:</b> <code>{condition_str}</code>\n"
                f"<b>Actual Value:</b> {value:.4f}\n"
                f"<b>Timeframe:</b> {timeframe}\n"
                f"<b>Bar Time:</b> {bar_time}\n"
                f"<b>Details:</b> {meta_str}"
            )
            url = f"https://api.telegram.org/bot{self.config.telegram.bot_token}/sendMessage"
            payload = {
                "chat_id": self.config.telegram.chat_id,
                "text": text,
                "parse_mode": "HTML"
            }
            response = requests.post(url, json=payload, timeout=10)
            response.raise_for_status()
            logger.debug(f"Successfully sent Telegram alert for {symbol}")
        except Exception as e:
            logger.error(f"Failed to send Telegram alert for {symbol}: {e}")
