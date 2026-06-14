import os
import pytest
import time
from datetime import datetime, timezone, timedelta
from src.database import StateDatabase
from src.engine import calculate_lookback_start, AlertEngine
from src.config import AppConfig

@pytest.fixture
def temp_db():
    # Set up a temporary test database
    db_path = "data/test_alerts.db"
    if os.path.exists(db_path):
        os.remove(db_path)
    
    db = StateDatabase(db_path=db_path)
    yield db
    
    # Tear down
    if os.path.exists(db_path):
        os.remove(db_path)

def test_database_trigger_and_cooldown(temp_db):
    rule_id = "test_rule"
    symbol = "AAPL"
    bar_time = "2026-06-02 17:00:00 UTC"
    cooldown = 5  # 5 seconds cooldown

    # 1. No record yet, should trigger
    assert temp_db.should_trigger(rule_id, bar_time, cooldown) is True

    # 2. Update trigger state
    temp_db.update_trigger_state(rule_id, symbol, bar_time, 25.5)

    # 3. Same bar time, should NOT trigger
    assert temp_db.should_trigger(rule_id, bar_time, cooldown) is False

    # 4. New bar time, but cooldown is active, should NOT trigger
    new_bar_time = "2026-06-02 17:15:00 UTC"
    assert temp_db.should_trigger(rule_id, new_bar_time, cooldown) is False

    # 5. Wait for cooldown to expire (5 seconds)
    time.sleep(5.1)

    # 6. New bar time and cooldown expired, should trigger
    assert temp_db.should_trigger(rule_id, new_bar_time, cooldown) is True

def test_calculate_lookback_start():
    # 1Min lookback with period 100
    t1 = calculate_lookback_start("1Min", 100)
    # 100 + 100 = 200 minutes buffer
    expected_delta_1min = timedelta(minutes=200)
    now = datetime.now(timezone.utc)
    diff_1min = now - t1
    assert abs(diff_1min.total_seconds() - expected_delta_1min.total_seconds()) < 5

    # 1Day lookback with period 100
    t2 = calculate_lookback_start("1Day", 100)
    # (100 + 100) * 1.5 = 300 days buffer
    expected_delta_1day = timedelta(days=300)
    diff_1day = now - t2
    assert abs(diff_1day.total_seconds() - expected_delta_1day.total_seconds()) < 60  # generous margin
