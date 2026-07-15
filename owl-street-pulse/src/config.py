import os
import re
import yaml
from typing import List, Dict, Any, Optional
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
    api_key: str = Field(..., description="Alpaca API Key ID")
    api_secret: str = Field(..., description="Alpaca API Secret Key")
    base_url: str = "https://paper-api.alpaca.markets"
    data_base_url: str = "https://data.alpaca.markets"

    @field_validator("api_key", "api_secret")
    @classmethod
    def check_non_empty(cls, v: str) -> str:
        if not v or v.strip() == "":
            raise ValueError("Credentials cannot be empty. Please check your config or environment variables.")
        return v

class NotifierConsoleConfig(BaseModel):
    enabled: bool = True

class NotifierWebhookConfig(BaseModel):
    enabled: bool = False
    webhook_url: Optional[str] = None

    @model_validator(mode="after")
    def validate_webhook(self) -> 'NotifierWebhookConfig':
        if self.enabled and not self.webhook_url:
            raise ValueError("webhook_url must be provided if notifier is enabled")
        return self

class NotifierTelegramConfig(BaseModel):
    enabled: bool = False
    bot_token: Optional[str] = None
    chat_id: Optional[str] = None

    @model_validator(mode="after")
    def validate_telegram(self) -> 'NotifierTelegramConfig':
        if self.enabled:
            if not self.bot_token or not self.chat_id:
                raise ValueError("bot_token and chat_id must be provided if Telegram notifier is enabled")
        return self

class NotifiersConfig(BaseModel):
    console: NotifierConsoleConfig = Field(default_factory=NotifierConsoleConfig)
    discord: NotifierWebhookConfig = Field(default_factory=NotifierWebhookConfig)
    slack: NotifierWebhookConfig = Field(default_factory=NotifierWebhookConfig)
    telegram: NotifierTelegramConfig = Field(default_factory=NotifierTelegramConfig)

class ConditionConfig(BaseModel):
    operator: str  # less_than, greater_than, cross_above, cross_below
    value: Optional[float] = None

    @field_validator("operator")
    @classmethod
    def check_operator(cls, v: str) -> str:
        allowed = ["less_than", "greater_than", "cross_above", "cross_below"]
        if v not in allowed:
            raise ValueError(f"Operator must be one of {allowed}")
        return v

    @model_validator(mode="after")
    def validate_value(self) -> 'ConditionConfig':
        # value is required for simple threshold comparisons
        if self.operator in ["less_than", "greater_than"] and self.value is None:
            raise ValueError(f"Value must be set for operator: {self.operator}")
        return self

class RuleConfig(BaseModel):
    id: str = Field(..., description="Unique rule ID")
    name: str = Field(..., description="Human readable rule name")
    timeframe: str = Field("15Min", description="Bar timeframe: 1Min, 5Min, 15Min, 1Hour, 1Day")
    indicator: str = Field(..., description="Technical indicator name (e.g. RSI, SMA_Cross, MACD_Cross)")
    params: Dict[str, Any] = Field(default_factory=dict)
    condition: ConditionConfig
    cooldown_seconds: int = 3600

    @field_validator("timeframe")
    @classmethod
    def check_timeframe(cls, v: str) -> str:
        allowed = ["1Min", "5Min", "15Min", "1Hour", "1Day"]
        if v not in allowed:
            raise ValueError(f"Timeframe must be one of {allowed}")
        return v

    @field_validator("indicator")
    @classmethod
    def check_indicator(cls, v: str) -> str:
        allowed = ["RSI", "SMA", "EMA", "MACD", "Bollinger_Bands", "SMA_Cross", "EMA_Cross", "MACD_Cross"]
        if v not in allowed:
            raise ValueError(f"Indicator must be one of {allowed}")
        return v

class MonitorConfig(BaseModel):
    symbol: str
    asset_class: str = "stock"  # stock or crypto
    rules: List[RuleConfig]

    @field_validator("asset_class")
    @classmethod
    def check_asset_class(cls, v: str) -> str:
        allowed = ["stock", "crypto"]
        if v not in allowed:
            raise ValueError(f"asset_class must be one of {allowed}")
        return v

class GoogleSsoConfig(BaseModel):
    client_id: Optional[str] = Field(None, description="Google Client ID")
    client_secret: Optional[str] = Field(None, description="Google Client Secret")
    redirect_uri: Optional[str] = Field(None, description="Google Redirect URI")
    allowed_emails: Optional[str] = Field(None, description="Allowed Emails List")

class TempleSsoConfig(BaseModel):
    client_id: Optional[str] = Field(None, description="Temple Client ID (e.g. 'mock' or real ID)")
    client_secret: Optional[str] = Field(None, description="Temple Client Secret")
    redirect_uri: Optional[str] = Field(None, description="Temple Redirect URI")
    auth_url: str = Field("https://fim.temple.edu/idp/profile/oidc/authorize", description="Temple Auth URL")
    token_url: str = Field("https://fim.temple.edu/idp/profile/oidc/token", description="Temple Token URL")
    userinfo_url: str = Field("https://fim.temple.edu/idp/profile/oidc/userinfo", description="Temple Userinfo URL")

class AppConfig(BaseModel):
    alpaca: AlpacaConfig
    poll_interval_seconds: int = 60
    notifiers: NotifiersConfig = Field(default_factory=NotifiersConfig)
    monitors: List[MonitorConfig]
    google_sso: GoogleSsoConfig = Field(default_factory=GoogleSsoConfig)
    temple_sso: TempleSsoConfig = Field(default_factory=TempleSsoConfig)

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
        "ALPACA_API_KEY", "ALPACA_API_SECRET", 
        "DISCORD_WEBHOOK_URL", "SLACK_WEBHOOK_URL", 
        "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
        "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "ALLOWED_EMAILS",
        "TEMPLE_CLIENT_ID", "TEMPLE_CLIENT_SECRET", "TEMPLE_REDIRECT_URI",
        "TEMPLE_AUTH_URL", "TEMPLE_TOKEN_URL", "TEMPLE_USERINFO_URL"
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

