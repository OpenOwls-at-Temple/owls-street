import os
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

# Import app but patch AlpacaService init or run to avoid live network connection
with patch("src.web.AlpacaService") as mock_service:
    from src.web import app
    import src.web

client = TestClient(app)

@pytest.fixture
def mock_config_path(tmp_path):
    cfg_file = tmp_path / "config.yaml"
    cfg_content = """
alpaca:
  api_key: "TESTKEY"
  api_secret: "TESTSECRET"
  mode: "paper"
fmp:
  api_key: ""
server:
  host: "0.0.0.0"
  port: 8080
dashboard_password: "securepassword"
pulse_url: "http://localhost:8000"
google_sso:
  client_id: "mock"
  client_secret: "secret"
  redirect_uri: ""
  allowed_emails: "test@gmail.com"

microsoft_sso:
  client_id: "mock"
  client_secret: "secret"
  redirect_uri: ""
  allowed_emails: "test@gmail.com"
"""
    cfg_file.write_text(cfg_content)
    return str(cfg_file)

def test_get_status_auth(tmp_path, mock_config_path):
    # Setup mock config
    from src.config import load_config
    src.web.app_config = load_config(mock_config_path)
    src.web.dashboard_password = "securepassword"
    
    # 1. Access status without token -> Should return authorized=False
    response = client.get("/api/status")
    assert response.status_code == 200
    data = response.json()
    assert data["auth_enabled"] is True
    assert data["authorized"] is False
    assert data["google_enabled"] is True
    assert data["microsoft_enabled"] is True
    assert data["password_enabled"] is True

    # 2. Login with correct password -> Should set cookie
    response = client.post("/api/auth/login", json={"password": "securepassword"})
    assert response.status_code == 200
    
    # 3. Access config status endpoint
    response = client.get("/api/auth/config")
    assert response.status_code == 200
    assert response.json()["google_enabled"] is True
    assert response.json()["microsoft_enabled"] is True

def test_sso_redirects_and_mock(tmp_path, mock_config_path):
    # Setup mock config
    from src.config import load_config
    src.web.app_config = load_config(mock_config_path)
    src.web.dashboard_password = "" # No password auth, only SSO
    
    # Google SSO Redirect
    response = client.get("/api/auth/google/login", follow_redirects=False)
    assert response.status_code == 307
    assert "/auth/google-mock/login" in response.headers.get("location")
    
    # Google mock login page render
    response = client.get("/auth/google-mock/login", params={"state": "teststate"})
    assert response.status_code == 200
    assert "Google Accounts (Demo)" in response.text
    
    # Google Mock Callback Success
    response = client.get("/api/auth/google/callback", params={"code": "mock_code", "email": "test@gmail.com"}, follow_redirects=False)
    assert response.status_code == 307
    assert response.headers.get("location") == "/"
    
    # Google Mock Callback Forbidden
    response = client.get("/api/auth/google/callback", params={"code": "mock_code", "email": "hacker@gmail.com"})
    assert response.status_code == 403
    
    # Session authorization endpoint Google (Success)
    response = client.post("/api/auth/session", json={"email": "test@gmail.com", "provider": "google"})
    assert response.status_code == 200
    assert response.json()["status"] == "success"
    
    # Session authorization endpoint Google (Forbidden)
    response = client.post("/api/auth/session", json={"email": "hacker@gmail.com", "provider": "google"})
    assert response.status_code == 403
    
    # Microsoft SSO Redirect
    response = client.get("/api/auth/microsoft/login", follow_redirects=False)
    assert response.status_code == 307
    assert "microsoft/mock-login" in response.headers.get("location")
    ms_state = client.cookies.get("oauth_state")
    
    # Microsoft mock login page render
    response = client.get("/api/auth/microsoft/mock-login", params={"state": ms_state})
    assert response.status_code == 200
    assert "Microsoft Sign In (Simulated)" in response.text
    
    # Microsoft Mock Callback Success
    response = client.get("/api/auth/microsoft/callback", params={"code": "mock_code", "state": ms_state, "email": "test@gmail.com"}, follow_redirects=False)
    assert response.status_code == 307
    assert response.headers.get("location") == "/"
    
    # Microsoft Mock Callback Forbidden
    client.cookies.set("oauth_state", "teststate_ms2")
    response = client.get("/api/auth/microsoft/callback", params={"code": "mock_code", "state": "teststate_ms2", "email": "hacker@gmail.com"})
    assert response.status_code == 403



def test_chat_proxy(tmp_path, mock_config_path):
    # Setup mock config
    from src.config import load_config
    src.web.app_config = load_config(mock_config_path)
    src.web.pulse_url = "http://localhost:8001"
    src.web.dashboard_password = "securepassword"
    
    # Mock the httpx POST request to pulse backend
    with patch("httpx.AsyncClient.post") as mock_post:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "success", "response": "Hello from Pulse!"}
        mock_post.return_value = mock_response
        
        # Access with authorized cookie
        response = client.post("/api/chat", json={"message": "Hello?"}, cookies={"session_token": "securepassword"})
        assert response.status_code == 200
        assert response.json()["response"] == "Hello from Pulse!"
        
        # Verify that it forwarded correctly
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        assert args[0] == "http://localhost:8001/api/chat"
        assert kwargs["cookies"]["session_token"] == "securepassword"




