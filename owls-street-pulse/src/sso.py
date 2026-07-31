"""Shared SSO primitives.

The security-critical parts of the OAuth flow live here so the daemon app (src/web.py) and
the serverless app (src/vercel_app.py) cannot drift apart — the kind of divergence that
previously left the view sending a cookie name Pulse had stopped reading.

Deliberate design points:

* Mock sign-in is opt-in. Setting ALLOW_MOCK_SSO=1 enables the local development path that
  issues a session without contacting Google. With it unset — the default, and therefore
  every deployment — a mock code is rejected outright. Previously any caller could pass
  `code=mock_code&email=<anything>` and be handed a valid session.
* There is no fallback identity. A callback that cannot complete a real token exchange
  fails; it never invents a user.
* OAuth state is random per attempt and checked against a cookie, so a callback cannot be
  replayed or forged from another site.
"""
import hashlib
import logging
import os
import secrets
import urllib.parse
from typing import Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo"

STATE_COOKIE = "oauth_state"
ORIGIN_COOKIE = "sso_redirect_origin"


class SsoError(Exception):
    """Raised when a sign-in attempt cannot be completed. Message is caller-safe."""


def mock_sso_enabled() -> bool:
    """True only when ALLOW_MOCK_SSO is explicitly set. Never enable in a deployment."""
    return os.environ.get("ALLOW_MOCK_SSO", "").strip().lower() in ("1", "true", "yes")


def resolve_google_credentials(config=None) -> Tuple[Optional[str], Optional[str], Optional[str], str]:
    """Google credentials from the config file when present, else the environment."""
    client_id = client_secret = redirect_uri = None
    allowed = None

    google_cfg = getattr(config, "google_sso", None) if config is not None else None
    if google_cfg is not None:
        client_id = google_cfg.client_id
        client_secret = google_cfg.client_secret
        redirect_uri = google_cfg.redirect_uri
        allowed = google_cfg.allowed_emails

    client_id = client_id or os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = client_secret or os.environ.get("GOOGLE_CLIENT_SECRET")
    redirect_uri = redirect_uri or os.environ.get("GOOGLE_REDIRECT_URI")
    allowed = allowed or os.environ.get("ALLOWED_EMAILS", "")

    # "mock" is a placeholder in the example env files, not a usable client id.
    if client_id == "mock":
        client_id = None

    return client_id, client_secret, redirect_uri, (allowed or "")


def google_configured(config=None) -> bool:
    client_id, client_secret, _, _ = resolve_google_credentials(config)
    return bool(client_id and client_secret)


def callback_url(request, configured_redirect_uri: Optional[str] = None) -> str:
    """The redirect_uri to send Google, which must match the console entry exactly.

    An explicit GOOGLE_REDIRECT_URI always wins. Otherwise it is derived from the request,
    forcing https for anything that is not localhost — behind a platform proxy the request
    often presents as http, and Google rejects a plain-http redirect for a public host.
    """
    if configured_redirect_uri:
        return configured_redirect_uri

    base = str(request.base_url)
    if base.startswith("http://") and not base.startswith(("http://localhost", "http://127.0.0.1")):
        base = "https://" + base[len("http://"):]
    return f"{base.rstrip('/')}/api/auth/google/callback"


def new_state() -> str:
    return secrets.token_urlsafe(24)


def google_auth_url(client_id: str, redirect_uri: str, state: str) -> str:
    params = {
        "client_id": client_id,
        "response_type": "code",
        "scope": "openid email profile",
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return f"{GOOGLE_AUTH_ENDPOINT}?{urllib.parse.urlencode(params)}"


def verify_state(request, state: Optional[str]) -> None:
    """Reject a callback whose state does not match the cookie set at login."""
    expected = request.cookies.get(STATE_COOKIE)
    if not state or not expected or not secrets.compare_digest(state, expected):
        raise SsoError("Invalid or missing OAuth state. Start the sign-in again.")


async def exchange_google_code(client_id: str, client_secret: str, code: str, redirect_uri: str) -> Tuple[str, str]:
    """Trade an authorization code for the user's verified email and name."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            token_res = await client.post(
                GOOGLE_TOKEN_ENDPOINT,
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": redirect_uri,
                },
            )
            token_data = token_res.json()
            access_token = token_data.get("access_token")
            if not access_token:
                logger.error("Google token exchange returned no access_token: %s", token_data.get("error"))
                raise SsoError("Google rejected the sign-in attempt.")

            userinfo_res = await client.get(
                GOOGLE_USERINFO_ENDPOINT,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            userinfo = userinfo_res.json()
    except SsoError:
        raise
    except Exception as e:
        logger.error("Google OAuth exchange failed: %s", e, exc_info=True)
        raise SsoError("Could not reach Google to complete sign-in.")

    email = userinfo.get("email")
    if not email:
        raise SsoError("Google did not return an email address for this account.")
    if userinfo.get("email_verified") is False:
        raise SsoError("This Google account has no verified email address.")

    return email, userinfo.get("name") or email.split("@")[0]


def check_email_allowed(email: str, allowed_emails: str) -> None:
    """Enforce the allowlist when one is configured."""
    if not allowed_emails:
        return
    permitted = [e.strip().lower() for e in allowed_emails.split(",") if e.strip()]
    if permitted and email.lower() not in permitted:
        raise SsoError(f"{email} is not authorized to access this dashboard.")


def session_payload(email: str, name: str, provider: str = "google") -> dict:
    return {
        "email": email,
        "name": name,
        "provider": provider,
        "avatar": f"https://www.gravatar.com/avatar/{hashlib.md5(email.lower().encode()).hexdigest()}?d=mp",
    }
