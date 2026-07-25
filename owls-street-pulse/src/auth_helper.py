import hmac
import hashlib
import base64
import json
import time
import os
from typing import Dict, Any, Optional

def base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')

def base64url_decode(data: str) -> bytes:
    padding = '=' * (4 - (len(data) % 4))
    return base64.urlsafe_b64decode(data + padding)

def get_jwt_secret() -> str:
    # Check SSO_JWT_SECRET first, fallback to DASHBOARD_PASSWORD, then fallback to a static default
    secret = os.environ.get("SSO_JWT_SECRET")
    if not secret:
        secret = os.environ.get("DASHBOARD_PASSWORD")
    if not secret:
        secret = "owls-street-default-jwt-secret-key-998877"
    return secret

def create_jwt(payload: dict, expires_in: int = 30 * 24 * 3600) -> str:
    """Creates a signed JWT token valid for the specified duration (seconds)."""
    secret = get_jwt_secret()
    header = {"alg": "HS256", "typ": "JWT"}
    
    # Make a copy of payload and inject exp
    payload_copy = payload.copy()
    payload_copy["exp"] = int(time.time()) + expires_in
    
    header_b64 = base64url_encode(json.dumps(header).encode('utf-8'))
    payload_b64 = base64url_encode(json.dumps(payload_copy).encode('utf-8'))
    
    signature_input = f"{header_b64}.{payload_b64}".encode('utf-8')
    signature = hmac.new(secret.encode('utf-8'), signature_input, hashlib.sha256).digest()
    signature_b64 = base64url_encode(signature)
    
    return f"{header_b64}.{payload_b64}.{signature_b64}"

def verify_jwt(token: str) -> Optional[Dict[str, Any]]:
    """Verifies a signed JWT token. Returns decoded payload if valid, else None."""
    if not token:
        return None
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
            
        header_b64, payload_b64, signature_b64 = parts
        signature_input = f"{header_b64}.{payload_b64}".encode('utf-8')
        
        secret = get_jwt_secret()
        expected_signature = hmac.new(secret.encode('utf-8'), signature_input, hashlib.sha256).digest()
        expected_signature_b64 = base64url_encode(expected_signature)
        
        if not hmac.compare_digest(signature_b64, expected_signature_b64):
            return None
            
        payload = json.loads(base64url_decode(payload_b64).decode('utf-8'))
        if payload.get("exp", 0) < time.time():
            return None
            
        return payload
    except Exception:
        return None

# Mock Portal HTML Templates
MOCK_GOOGLE_LOGIN_HTML = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign in - Google Accounts (Demo)</title>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Roboto', sans-serif;
            background-color: #f0f4f9;
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
        }
        .card {
            background: white;
            border: 1px solid #dadce0;
            border-radius: 8px;
            padding: 40px;
            width: 360px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }
        .google-logo {
            text-align: center;
            font-size: 24px;
            font-weight: 500;
            margin-bottom: 16px;
        }
        .google-logo span:nth-child(1) { color: #4285F4; }
        .google-logo span:nth-child(2) { color: #EA4335; }
        .google-logo span:nth-child(3) { color: #FBBC05; }
        .google-logo span:nth-child(4) { color: #4285F4; }
        .google-logo span:nth-child(5) { color: #34A853; }
        .google-logo span:nth-child(6) { color: #EA4335; }
        
        .header {
            text-align: center;
            margin-bottom: 24px;
        }
        .header h1 {
            font-size: 24px;
            font-weight: 400;
            color: #202124;
            margin: 0 0 8px 0;
        }
        .header p {
            font-size: 16px;
            color: #202124;
            margin: 0;
        }
        .alert-demo {
            background-color: #e8f0fe;
            border: 1px solid #1a73e8;
            border-radius: 4px;
            padding: 12px;
            font-size: 13px;
            color: #1a73e8;
            margin-bottom: 20px;
            line-height: 1.4;
        }
        .input-group {
            margin-bottom: 24px;
        }
        .input-group input {
            width: 100%;
            padding: 16px;
            border: 1px solid #dadce0;
            border-radius: 4px;
            font-size: 16px;
            outline: none;
            box-sizing: border-box;
        }
        .input-group input:focus {
            border-color: #1a73e8;
            border-width: 2px;
            padding: 15px;
        }
        .actions {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .btn-link {
            color: #1a73e8;
            text-decoration: none;
            font-weight: 500;
            font-size: 14px;
            background: none;
            border: none;
            cursor: pointer;
            padding: 0;
        }
        .btn-primary {
            background-color: #1a73e8;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 10px 24px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        .btn-primary:hover {
            background-color: #1557b0;
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="google-logo">
            <span>G</span><span>o</span><span>o</span><span>g</span><span>l</span><span>e</span>
        </div>
        <div class="header">
            <h1>Sign in</h1>
            <p>to continue to Owls Street App</p>
        </div>
        <div class="alert-demo">
            <strong>Demonstration Mode:</strong> Enter any Google email and name below to simulate authentication.
        </div>
        <form id="loginForm">
            <div class="input-group">
                <input type="email" id="email" placeholder="Email or phone" value="shuv@gmail.com" required>
            </div>
            <div class="input-group">
                <input type="text" id="name" placeholder="Full name (optional)" value="Shuv" required>
            </div>
            <div class="actions">
                <button type="button" class="btn-link" onclick="useAlternative()">Use demo account</button>
                <button type="submit" class="btn-primary">Next</button>
            </div>
        </form>
    </div>

    <script>
        function useAlternative() {
            document.getElementById("email").value = "owl.investor@gmail.com";
            document.getElementById("name").value = "Owl Investor";
        }

        document.getElementById("loginForm").addEventListener("submit", function(e) {
            e.preventDefault();
            const email = encodeURIComponent(document.getElementById("email").value);
            const name = encodeURIComponent(document.getElementById("name").value);
            
            // Redirect back to backend callback with the credentials
            const urlParams = new URLSearchParams(window.location.search);
            const state = urlParams.get('state') || '';
            
            window.location.href = `/api/auth/google/callback?code=mock_code&email=${email}&name=${name}&state=${state}`;
        });
    </script>
</body>
</html>
"""

