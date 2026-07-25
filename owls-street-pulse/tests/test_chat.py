import os
import asyncio
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
import pandas as pd
from fastapi.testclient import TestClient

from src.config import AppConfig, load_config
from src.chat import OwlSpeaksAgent
from src.web import app

# Create a test client
client = TestClient(app)

@pytest.fixture
def mock_config_path(tmp_path):
    cfg_file = tmp_path / "config.yaml"
    cfg_content = """
alpaca:
  api_key: "TESTKEY"
  api_secret: "TESTSECRET"
  base_url: "https://paper-api.alpaca.markets"
  data_base_url: "https://data.alpaca.markets"
poll_interval_seconds: 60
notifiers:
  console:
    enabled: true
monitors:
  - symbol: AAPL
    asset_class: stock
    rules:
      - id: aapl_rsi
        name: "AAPL RSI"
        timeframe: "15Min"
        indicator: RSI
        params:
          period: 14
        condition:
          operator: "less_than"
          value: 30.0
"""
    cfg_file.write_text(cfg_content)
    return str(cfg_file)

@pytest.fixture
def dummy_app_config(mock_config_path):
    return load_config(mock_config_path)

def test_owl_speaks_agent_init(dummy_app_config, tmp_path):
    db_file = str(tmp_path / "test_alerts.db")
    agent = OwlSpeaksAgent(config=dummy_app_config, db_path=db_file)
    assert agent.config.alpaca.api_key == "TESTKEY"
    assert agent.db_path == db_file

@patch("src.chat.AlpacaClient.get_historical_bars")
def test_get_symbol_context_unmonitored(mock_get_bars, dummy_app_config, tmp_path):
    db_file = str(tmp_path / "test_alerts.db")
    agent = OwlSpeaksAgent(config=dummy_app_config, db_path=db_file)
    
    # MSFT is not monitored
    context = agent.get_symbol_context("MSFT")
    assert "not currently monitored" in context
    assert mock_get_bars.call_count == 0

@patch("src.chat.AlpacaClient.get_historical_bars")
def test_get_symbol_context_monitored(mock_get_bars, dummy_app_config, tmp_path):
    db_file = str(tmp_path / "test_alerts.db")
    agent = OwlSpeaksAgent(config=dummy_app_config, db_path=db_file)
    
    # Mock return values for AAPL
    mock_df = pd.DataFrame(
        {"close": [150.0] * 30},
        index=pd.date_range("2026-06-10", periods=30, freq="15min")
    )
    mock_get_bars.return_value = {"AAPL": mock_df}
    
    context = agent.get_symbol_context("AAPL")
    assert "Technical Context for AAPL" in context
    assert "Current Price: $150.00" in context
    assert "Timeframe: 15Min" in context
    assert "Rule: AAPL RSI" in context
    assert mock_get_bars.call_count == 1

@patch("httpx.AsyncClient.post")
@patch("src.chat.OwlSpeaksAgent.get_symbol_context")
@patch("src.chat.AlpacaClient.get_snapshot")
@patch("src.chat.AlpacaClient.get_news")
def test_generate_response_success(mock_get_news, mock_get_snapshot, mock_get_context, mock_post, dummy_app_config, tmp_path):
    db_file = str(tmp_path / "test_alerts.db")
    agent = OwlSpeaksAgent(config=dummy_app_config, db_path=db_file)
    
    mock_get_context.return_value = "AAPL mock context content"
    mock_get_snapshot.return_value = {
        "latestTrade": {"p": 150.0, "s": 100},
        "latestQuote": {"ap": 150.1, "bp": 149.9},
        "dailyBar": {"h": 152.0, "l": 148.0, "v": 1000000}
    }
    mock_get_news.return_value = [
        {
            "headline": "AAPL surges on RAG features",
            "summary": "Apple stocks surged following implementation of advanced AI agent workspace.",
            "source": "Benzinga",
            "updated_at": "2026-07-13T12:00:00Z"
        }
    ]
    
    # Mock httpx response
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "message": {
            "role": "assistant",
            "content": "This is a mocked response from Ollama."
        }
    }
    mock_post.return_value = mock_response
    
    # Call generate_response synchronously using asyncio.run
    res = asyncio.run(agent.generate_response(
        user_message="Should I buy AAPL?",
        symbol="AAPL",
        history=[]
    ))
    
    assert res == "This is a mocked response from Ollama."
    assert mock_get_context.call_count == 1
    assert mock_post.call_count == 1
    assert mock_get_snapshot.call_count == 1
    assert mock_get_news.call_count == 1
    
    # Check payload structure passed to httpx.post
    args, kwargs = mock_post.call_args
    payload = kwargs["json"]
    assert payload["model"] == "llama3.1"
    assert len(payload["messages"]) == 2
    assert payload["messages"][0]["role"] == "system"
    assert "AAPL mock context" in payload["messages"][0]["content"]
    assert "AAPL surges on RAG features" in payload["messages"][0]["content"]
    assert payload["messages"][1]["content"] == "Should I buy AAPL?"

@patch("requests.get")
def test_alpaca_client_get_snapshot_and_get_news(mock_get, dummy_app_config):
    from src.alpaca import AlpacaClient
    client = AlpacaClient(api_key="TESTKEY", api_secret="TESTSECRET")
    
    # Mock return value for snapshot
    mock_snap_resp = MagicMock()
    mock_snap_resp.status_code = 200
    mock_snap_resp.json.return_value = {
        "symbol": "AAPL",
        "latestTrade": {"p": 180.25}
    }
    
    # Mock return value for news
    mock_news_resp = MagicMock()
    mock_news_resp.status_code = 200
    mock_news_resp.json.return_value = {
        "news": [{"headline": "AAPL news title"}]
    }
    
    mock_get.side_effect = [mock_snap_resp, mock_news_resp]
    
    snap = client.get_snapshot("AAPL", "stock")
    assert snap is not None
    assert snap["symbol"] == "AAPL"
    assert snap["latestTrade"]["p"] == 180.25
    
    news = client.get_news("AAPL", limit=1)
    assert len(news) == 1
    assert news[0]["headline"] == "AAPL news title"

def test_chat_api_endpoint(tmp_path, mock_config_path):
    # Setup paths in web.py
    import src.web
    src.web.CONFIG_PATH = mock_config_path
    src.web.DB_PATH = str(tmp_path / "alerts.db")
    
    # Mock the generate_response method of OwlSpeaksAgent
    with patch("src.chat.OwlSpeaksAgent.generate_response", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "Mocked LLM Response text"
        
        # Disable auth for simplicity
        with patch.dict(os.environ, {}, clear=True):
            response = client.post("/api/chat", json={
                "message": "Hello Owl Speaks",
                "symbol": "AAPL",
                "history": []
            })
            
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "success"
            assert data["response"] == "Mocked LLM Response text"
            assert mock_gen.call_count == 1
            
            # Verify call args
            mock_gen.assert_called_once_with(
                user_message="Hello Owl Speaks",
                symbol="AAPL",
                history=[],
                images=None
            )
