import os
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

# Import app but prevent it from starting background thread immediately during import
with patch("src.web.BackgroundEngineRunner.start") as mock_start:
    import src.web
    from src.web import app

client = TestClient(app)

@pytest.fixture
def mock_config_path(tmp_path):
    # Create a dummy config.yaml
    cfg_dir = tmp_path / "config"
    cfg_dir.mkdir()
    cfg_file = cfg_dir / "config.yaml"
    
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
monitors: []
"""
    cfg_file.write_text(cfg_content)
    return str(cfg_file)

def test_get_dashboard():
    response = client.get("/")
    assert response.status_code == 200
    assert "Owl Street Pulse" in response.text

def test_get_status_no_auth(tmp_path, mock_config_path):
    # Overwrite configuration path constants directly to avoid mock path validation exceptions
    src.web.CONFIG_PATH = mock_config_path
    src.web.DB_PATH = str(tmp_path / "alerts.db")
    
    # Ensure password auth is not set
    with patch.dict(os.environ, {}, clear=True):
        # Mock global runner status
        src.web.runner.status = "running"
        src.web.runner.start_time = 1000.0
        src.web.runner.last_check_time = "2026-06-10T12:00:00Z"
        
        response = client.get("/api/status")
        assert response.status_code == 200
        data = response.json()
        assert data["engine_status"] == "running"
        assert data["poll_interval_seconds"] == 60

def test_auth_endpoints(tmp_path, mock_config_path):
    # Set paths
    src.web.CONFIG_PATH = mock_config_path
    src.web.DB_PATH = str(tmp_path / "alerts.db")
    
    # Set password in environment for test
    with patch.dict(os.environ, {"DASHBOARD_PASSWORD": "securepassword"}):
        # 1. Access status without password -> Should fail 401
        response = client.get("/api/status")
        assert response.status_code == 401
        
        # 2. Login with wrong password -> Should fail 400
        response = client.post("/api/auth/login", json={"password": "wrongpassword"})
        assert response.status_code == 400
        
        # 3. Login with correct password -> Should succeed and set cookie
        response = client.post("/api/auth/login", json={"password": "securepassword"})
        assert response.status_code == 200
        cookie_header = response.headers.get("set-cookie")
        assert "session_token=securepassword" in cookie_header
        
        # 4. Access status with the cookie -> Should succeed 200
        client.cookies.set("session_token", "securepassword")
        response = client.get("/api/status")
        assert response.status_code == 200
        
        # 5. Logout -> Should clear cookie
        response = client.post("/api/auth/logout")
        assert response.status_code == 200

def test_sso_endpoints(tmp_path, mock_config_path):
    # Set paths
    src.web.CONFIG_PATH = mock_config_path
    src.web.DB_PATH = str(tmp_path / "alerts.db")
    
    # Configure mock client IDs
    import yaml
    with open(mock_config_path, "r") as f:
        cfg = yaml.safe_load(f)
    cfg["google_sso"] = {
        "client_id": "mock",
        "client_secret": "secret",
        "redirect_uri": "",
        "allowed_emails": "test@gmail.com"
    }
    cfg["temple_sso"] = {
        "client_id": "mock",
        "client_secret": "secret",
        "redirect_uri": "",
        "auth_url": "https://fim.temple.edu/idp/profile/oidc/authorize",
        "token_url": "https://fim.temple.edu/idp/profile/oidc/token",
        "userinfo_url": "https://fim.temple.edu/idp/profile/oidc/userinfo"
    }
    with open(mock_config_path, "w") as f:
        yaml.safe_dump(cfg, f)
        
    with patch.dict(os.environ, {"DASHBOARD_PASSWORD": ""}):
        # 1. Check auth config endpoint
        response = client.get("/api/auth/config")
        assert response.status_code == 200
        data = response.json()
        assert data["auth_enabled"] is True
        assert data["google_enabled"] is True
        assert data["temple_enabled"] is True
        assert data["password_enabled"] is False
        
        # 2. Test Google SSO Login Redirect (Mock mode)
        response = client.get("/api/auth/google/login", follow_redirects=False)
        assert response.status_code == 307
        target_url = response.headers.get("location")
        assert "mock-login" in target_url
        
        # 3. Test Google Mock Callback (Correct Email)
        client.cookies.set("oauth_state", "teststate")
        response = client.get("/api/auth/google/mock-callback", params={"email": "test@gmail.com", "state": "teststate"}, follow_redirects=False)
        assert response.status_code == 307
        cookie_header = response.headers.get("set-cookie")
        assert "session_token=" in cookie_header
        
        # 4. Test Google Mock Callback (Unauthorized Email)
        client.cookies.set("oauth_state", "teststate2")
        response = client.get("/api/auth/google/mock-callback", params={"email": "hacker@gmail.com", "state": "teststate2"})
        assert response.status_code == 403
        
        # 5. Test Temple SSO Login Redirect (Mock mode)
        response = client.get("/api/auth/temple/login", follow_redirects=False)
        assert response.status_code == 307
        target_url = response.headers.get("location")
        assert "mock-login" in target_url
        
        # 6. Test Temple Mock Callback
        client.cookies.set("oauth_state", "teststate3")
        response = client.get("/api/auth/temple/mock-callback", params={"username": "test@gmail.com", "state": "teststate3"}, follow_redirects=False)
        assert response.status_code == 307
        cookie_header = response.headers.get("set-cookie")
        assert "session_token=" in cookie_header


def test_config_endpoints(tmp_path, mock_config_path):
    # Set paths
    src.web.CONFIG_PATH = mock_config_path
    src.web.DB_PATH = str(tmp_path / "alerts.db")
    
    with patch.dict(os.environ, {}, clear=True):
        # Get Config
        response = client.get("/api/config")
        assert response.status_code == 200
        config_data = response.json()
        assert config_data["alpaca"]["api_key"] == "TESTKEY"
        
        # Post Valid Config
        config_data["poll_interval_seconds"] = 30
        response = client.post("/api/config", json=config_data)
        assert response.status_code == 200
        
        # Verify it saved
        response = client.get("/api/config")
        assert response.json()["poll_interval_seconds"] == 30
        
        # Post Invalid Config (Missing API secret key)
        config_data["alpaca"]["api_secret"] = ""
        response = client.post("/api/config", json=config_data)
        assert response.status_code == 422
