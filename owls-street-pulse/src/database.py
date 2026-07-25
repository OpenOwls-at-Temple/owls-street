import os
import sqlite3
import time
import logging
from typing import Optional

logger = logging.getLogger(__name__)

class StateDatabase:
    def __init__(self, db_path: str = "data/alerts.db"):
        self.db_path = db_path
        self._ensure_dir_exists()
        self.init_db()

    def _ensure_dir_exists(self):
        """Ensures that the directory for the database exists."""
        dir_name = os.path.dirname(self.db_path)
        if dir_name and not os.path.exists(dir_name):
            logger.info(f"Creating database directory: {dir_name}")
            os.makedirs(dir_name, exist_ok=True)

    def _get_connection(self) -> sqlite3.Connection:
        """Returns a sqlite3 connection."""
        return sqlite3.connect(self.db_path)

    def init_db(self):
        """Creates the state tracking and history tables if they do not exist."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS alert_states (
                    rule_id TEXT PRIMARY KEY,
                    symbol TEXT NOT NULL,
                    last_triggered_at REAL NOT NULL,
                    last_triggered_bar_time TEXT NOT NULL,
                    last_triggered_value REAL NOT NULL
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS alert_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    rule_id TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    triggered_at REAL NOT NULL,
                    bar_time TEXT NOT NULL,
                    value REAL NOT NULL
                )
            """)
            conn.commit()

    def should_trigger(self, rule_id: str, bar_time: str, cooldown_seconds: int) -> bool:
        """
        Determines whether a rule alert should trigger.
        
        It checks:
        1. If the current bar has already triggered an alert for this rule (bar_time check).
        2. If the cooldown period has elapsed since the last alert (cooldown check).
        """
        now = time.time()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT last_triggered_at, last_triggered_bar_time FROM alert_states WHERE rule_id = ?",
                (rule_id,)
            )
            row = cursor.fetchone()
            
            if not row:
                return True

            last_triggered_at, last_triggered_bar_time = row

            # Prevent triggering multiple times for the exact same bar (candle)
            if last_triggered_bar_time == bar_time:
                logger.debug(f"Rule '{rule_id}' already triggered for bar time '{bar_time}'. Skipping.")
                return False

            # Check if cooldown is active
            time_elapsed = now - last_triggered_at
            if time_elapsed < cooldown_seconds:
                remaining = int(cooldown_seconds - time_elapsed)
                logger.debug(f"Rule '{rule_id}' is in cooldown. {remaining} seconds remaining. Skipping.")
                return False

            return True

    def update_trigger_state(self, rule_id: str, symbol: str, bar_time: str, value: float):
        """Updates or inserts the trigger state of a rule and records history."""
        now = time.time()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT OR REPLACE INTO alert_states 
                (rule_id, symbol, last_triggered_at, last_triggered_bar_time, last_triggered_value) 
                VALUES (?, ?, ?, ?, ?)
                """,
                (rule_id, symbol, now, bar_time, value)
            )
            cursor.execute(
                """
                INSERT INTO alert_history 
                (rule_id, symbol, triggered_at, bar_time, value) 
                VALUES (?, ?, ?, ?, ?)
                """,
                (rule_id, symbol, now, bar_time, value)
            )
            conn.commit()
            logger.debug(f"Updated state and recorded history for rule '{rule_id}' with bar_time '{bar_time}'")

    def clear_state(self, rule_id: str):
        """Clears the saved trigger state for a specific rule."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM alert_states WHERE rule_id = ?", (rule_id,))
            conn.commit()
            logger.debug(f"Cleared state for rule '{rule_id}'")

    def get_all_alerts(self, limit: int = 100) -> list:
        """Retrieves recently triggered alerts, sorted by triggered_at descending."""
        with self._get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, rule_id, symbol, triggered_at, bar_time, value 
                FROM alert_history 
                ORDER BY triggered_at DESC 
                LIMIT ?
                """,
                (limit,)
            )
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def clear_history(self):
        """Clears the historical alert log."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM alert_history")
            conn.commit()
            logger.info("Cleared all historical alerts from database.")

