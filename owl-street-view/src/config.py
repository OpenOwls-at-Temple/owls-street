import os
import re
import yaml
from typing import Optional, Any
from pydantic import BaseModel, Field, field_validator, model_validator
from dotenv import load_dotenv

# Load .env file if present
load_dotenv()

def expand_env_vars(text: str) -> str:
    """Replaces ${VAR_NAME} with corresponding environment variable values."""
    pattern = re.compile(r'\$\{(\w+)\}')
    def replacer(match):
        env_var = match.group(1)
        # Fallback to empty string if not found, to let pydantic validate
        return os.environ.get(env_var, "")
    return pattern.sub(replacer, text)

class AlpacaConfig(BaseModel):
    api_key: str = Field("MOCK_KEY", description="Alpaca API Key ID")
    api_secret: str = Field("MOCK_SECRET", description="Alpaca API Secret Key")
    mode: str = Field("paper", description="Alpaca Mode: paper or live")

    @field_validator("api_key", "api_secret")
    @classmethod
    def check_non_empty(cls, v: str) -> str:
        if not v or v.strip() == "":
            return "MOCK_KEY"
        return v

    @field_validator("mode")
    @classmethod
    def check_mode(cls, v: str) -> str:
        allowed = ["paper", "live"]
        v_low = v.strip().lower()
        if v_low not in allowed:
            raise ValueError("mode must be 'paper' or 'live'")
        return v_low

class FmpConfig(BaseModel):
    api_key: Optional[str] = Field(None, description="FMP API Key")

class GoogleSsoConfig(BaseModel):
    client_id: Optional[str] = Field(None, description="Google Client ID")
    client_secret: Optional[str] = Field(None, description="Google Client Secret")
    redirect_uri: Optional[str] = Field(None, description="Google Redirect URI")
    allowed_emails: Optional[str] = Field(None, description="Allowed Emails List")


class MicrosoftSsoConfig(BaseModel):
    client_id: Optional[str] = Field(None, description="Microsoft Client ID")
    client_secret: Optional[str] = Field(None, description="Microsoft Client Secret")
    redirect_uri: Optional[str] = Field(None, description="Microsoft Redirect URI")
    allowed_emails: Optional[str] = Field(None, description="Allowed Emails List")

class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8080

class AppConfig(BaseModel):
    alpaca: AlpacaConfig
    fmp: FmpConfig = Field(default_factory=FmpConfig)
    google_sso: GoogleSsoConfig = Field(default_factory=GoogleSsoConfig)

    microsoft_sso: MicrosoftSsoConfig = Field(default_factory=MicrosoftSsoConfig)
    server: ServerConfig = Field(default_factory=ServerConfig)
    dashboard_password: Optional[str] = None
    pulse_url: str = "http://localhost:8000"

    @field_validator("pulse_url")
    @classmethod
    def check_pulse_url(cls, v: str) -> str:
        if not v or v.strip() == "":
            return "http://localhost:8000"
        return v.strip()


def load_config(filepath: str) -> AppConfig:
    """Loads configuration file and applies environment variable expansions."""
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"Configuration file not found: {filepath}")
        
    with open(filepath, "r") as f:
        raw_text = f.read()
        
    expanded_text = expand_env_vars(raw_text)
    yaml_data = yaml.safe_load(expanded_text)
    
    if not yaml_data:
        raise ValueError("Configuration file is empty")
        
    return AppConfig.model_validate(yaml_data)

def save_config(config: AppConfig, filepath: str):
    """Saves AppConfig back to YAML, restoring environment variable placeholders for secrets."""
    config_dict = config.model_dump()
    
    # Restore environmental variable placeholders for safety
    env_vars = [
        "ALPACA_API_KEY", "ALPACA_SECRET_KEY", 
        "FMP_API_KEY", "DASHBOARD_PASSWORD", "PULSE_URL",
        "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "ALLOWED_EMAILS",
        "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_REDIRECT_URI"
    ]

    
    def restore_placeholders(d: Any):
        if isinstance(d, dict):
            for k, v in d.items():
                if isinstance(v, str):
                    for ev in env_vars:
                        ev_val = os.environ.get(ev)
                        if ev_val and v == ev_val:
                            d[k] = f"${{{ev}}}"
                            break
                else:
                    restore_placeholders(v)
        elif isinstance(d, list):
            for item in d:
                restore_placeholders(item)
                
    restore_placeholders(config_dict)
    
    with open(filepath, "w") as f:
        yaml.safe_dump(config_dict, f, default_flow_style=False, sort_keys=False)

def load_config_from_env() -> AppConfig:
    """Fallback configuration loader reading directly from environment variables."""
    api_key = os.environ.get("ALPACA_API_KEY") or os.environ.get("APCA_API_KEY_ID") or "MOCK_KEY"
    api_secret = os.environ.get("ALPACA_SECRET_KEY") or os.environ.get("APCA_API_SECRET_KEY") or "MOCK_SECRET"
    mode = os.environ.get("ALPACA_MODE", "paper")
    fmp_key = os.environ.get("FMP_API_KEY", "")
    dashboard_password = os.environ.get("DASHBOARD_PASSWORD", "")
    pulse_url = os.environ.get("PULSE_URL", "http://localhost:8000")
    
    return AppConfig(
        alpaca=AlpacaConfig(api_key=api_key, api_secret=api_secret, mode=mode),
        fmp=FmpConfig(api_key=fmp_key),
        dashboard_password=dashboard_password,
        pulse_url=pulse_url,
    )
