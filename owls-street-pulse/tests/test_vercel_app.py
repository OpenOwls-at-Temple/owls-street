"""Tests for the serverless app: chat reachability, auth, and the /pulse mount.

The mount matters because one Vercel project can host both apps, with Pulse served under
/pulse. Vercel hands the function the original request path, so these paths are what the
app actually receives in that deployment.
"""
import os
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src import llm, vercel_app
from src.vercel_app import app

client = TestClient(app)

ROUTABLE_OLLAMA = "http://ollama.example.com:11434"


@pytest.fixture
def routable_ollama():
    """An Ollama endpoint a serverless function could actually reach."""
    with patch.dict(os.environ, {"OLLAMA_BASE_URL": ROUTABLE_OLLAMA}):
        yield


@pytest.fixture
def authed_client():
    """A client carrying the session cookie the view's chat proxy sends."""
    with patch.dict(os.environ, {"DASHBOARD_PASSWORD": "test-pass"}):
        c = TestClient(app)
        c.cookies.set(vercel_app.SESSION_COOKIE, "test-pass")
        yield c


# ── Reachability ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("base_url", [
    "http://localhost:11434",
    "http://127.0.0.1:11434",
    "http://0.0.0.0:11434",
])
def test_loopback_endpoints_are_not_reachable(base_url):
    with patch.dict(os.environ, {"OLLAMA_BASE_URL": base_url}):
        assert llm.ollama_is_local() is True
        assert vercel_app.chat_available() is False


def test_routable_endpoint_is_reachable(routable_ollama):
    assert llm.ollama_is_local() is False
    assert vercel_app.chat_available() is True


def test_unset_endpoint_defaults_to_loopback():
    with patch.dict(os.environ, {}, clear=True):
        assert llm.ollama_base_url() == llm.DEFAULT_OLLAMA_BASE_URL
        assert vercel_app.chat_available() is False


def test_base_url_is_read_per_call_not_cached_at_import():
    """A serverless cold start imports well before the request that needs the value."""
    with patch.dict(os.environ, {"OLLAMA_BASE_URL": "http://first.example.com"}):
        assert llm.ollama_base_url() == "http://first.example.com"
    with patch.dict(os.environ, {"OLLAMA_BASE_URL": "http://second.example.com/"}):
        assert llm.ollama_base_url() == "http://second.example.com"


# ── Status ─────────────────────────────────────────────────────────────────────

def test_status_reports_serverless_mode():
    response = client.get("/api/status")
    assert response.status_code == 200
    assert response.json()["serverless_mode"] is True


def test_status_reports_chat_availability(routable_ollama):
    assert client.get("/api/status").json()["chat_available"] is True


def test_status_reports_chat_unavailable_on_loopback():
    with patch.dict(os.environ, {"OLLAMA_BASE_URL": "http://localhost:11434"}):
        assert client.get("/api/status").json()["chat_available"] is False


# ── Chat ───────────────────────────────────────────────────────────────────────

def test_chat_explains_itself_when_no_endpoint_is_reachable(authed_client):
    with patch.dict(os.environ, {"OLLAMA_BASE_URL": "http://localhost:11434"}):
        response = authed_client.post("/api/chat", json={"message": "hi"})
    assert response.status_code == 503
    # The message has to name the variable to set; "unavailable in serverless mode" was
    # the old blanket answer and left nothing to act on.
    assert "OLLAMA_BASE_URL" in response.json()["message"]


def test_chat_requires_auth(routable_ollama):
    with patch.dict(os.environ, {"DASHBOARD_PASSWORD": "test-pass"}):
        response = TestClient(app).post("/api/chat", json={"message": "hi"})
    assert response.status_code == 401


def test_chat_answers_when_authorized_and_reachable(authed_client, routable_ollama):
    with patch("src.chat.OwlSpeaksAgent.generate_response", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "RSI measures momentum."
        response = authed_client.post("/api/chat", json={"message": "What is RSI?"})

    assert response.status_code == 200
    assert response.json() == {"status": "success", "response": "RSI measures momentum."}
    assert mock_gen.await_args.kwargs["user_message"] == "What is RSI?"


def test_chat_passes_symbol_history_and_images(authed_client, routable_ollama):
    payload = {
        "message": "Read this chart",
        "symbol": "AAPL",
        "history": [{"role": "user", "content": "hello"}],
        "images": ["Ym9ndXM="],
    }
    with patch("src.chat.OwlSpeaksAgent.generate_response", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "ok"
        response = authed_client.post("/api/chat", json=payload)

    assert response.status_code == 200
    kwargs = mock_gen.await_args.kwargs
    assert kwargs["symbol"] == "AAPL"
    assert kwargs["history"] == [{"role": "user", "content": "hello"}]
    assert kwargs["images"] == ["Ym9ndXM="]


def test_chat_survives_an_unloadable_config(authed_client, routable_ollama, tmp_path):
    """No config file is the normal case here — config.yaml is gitignored."""
    with patch.object(vercel_app, "CHAT_CONFIG_PATH", str(tmp_path / "absent.yaml")), \
         patch.object(vercel_app, "PULSE_ROOT", str(tmp_path)):
        assert vercel_app._serverless_chat_config() is None

        with patch("src.chat.OwlSpeaksAgent.generate_response", new_callable=AsyncMock) as mock_gen:
            mock_gen.return_value = "answered anyway"
            response = authed_client.post("/api/chat", json={"message": "What is RSI?"})

    assert response.status_code == 200
    assert response.json()["response"] == "answered anyway"


# ── Endpoints that genuinely need the engine ────────────────────────────────────

@pytest.mark.parametrize("method,path", [
    ("get", "/api/alerts"),
    ("get", "/api/config"),
    ("post", "/api/engine/start"),
    ("post", "/api/engine/stop"),
])
def test_engine_endpoints_remain_unavailable(method, path):
    response = getattr(client, method)(path)
    assert response.status_code == 503


# ── Serving under the /pulse prefix ────────────────────────────────────────────

@pytest.fixture
def mounted_client():
    """The app as api/pulse.py exposes it in the combined deployment."""
    outer = FastAPI()
    outer.mount("/pulse", app)
    return TestClient(outer)


def test_dashboard_is_served_under_the_prefix(mounted_client):
    response = mounted_client.get("/pulse/")
    assert response.status_code == 200
    assert "Owls Street Pulse" in response.text


def test_prefix_root_redirects_to_the_dashboard(mounted_client):
    response = mounted_client.get("/pulse", follow_redirects=False)
    assert response.status_code in (307, 308)
    assert response.headers["location"].endswith("/pulse/")


def test_api_is_served_under_the_prefix(mounted_client):
    response = mounted_client.get("/pulse/api/status")
    assert response.status_code == 200
    assert response.json()["serverless_mode"] is True


def test_dashboard_resolves_its_own_calls_against_the_prefix():
    """The template must not call /api/... directly, or it hits the view app instead."""
    template = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "src", "templates", "index.html",
    )
    with open(template) as f:
        html = f.read()

    for unprefixed in ('fetch("/api', "fetch('/api", 'fetch("/auth', 'href = "/api'):
        assert unprefixed not in html, f"{unprefixed} bypasses resolveUrl()"
