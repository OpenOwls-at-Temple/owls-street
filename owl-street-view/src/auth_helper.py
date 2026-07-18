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
            <p>to continue to Owl Street App</p>
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

MOCK_TEMPLE_LOGIN_HTML = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Temple University - Single Sign-On (Demo)</title>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Montserrat', sans-serif;
            background-color: #f7f7f7;
            margin: 0;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
        }
        .header-bar {
            background-color: #9e1b32; /* Temple Cherry */
            color: white;
            padding: 15px 30px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header-logo {
            font-size: 20px;
            font-weight: 700;
            letter-spacing: 1px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .t-badge {
            background-color: white;
            color: #9e1b32;
            width: 32px;
            height: 32px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 900;
            font-size: 22px;
        }
        .container {
            flex-grow: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .card {
            background: white;
            border-top: 5px solid #9e1b32;
            border-radius: 4px;
            padding: 40px;
            width: 380px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        }
        .card h2 {
            margin: 0 0 10px 0;
            color: #333;
            font-size: 22px;
            font-weight: 600;
        }
        .card p.subtitle {
            color: #666;
            font-size: 14px;
            margin: 0 0 24px 0;
            line-height: 1.4;
        }
        .alert-demo {
            background-color: #fdf2f2;
            border: 1px solid #f8b4b4;
            border-radius: 4px;
            padding: 12px;
            font-size: 13px;
            color: #9e1b32;
            margin-bottom: 20px;
            line-height: 1.4;
        }
        .form-group {
            margin-bottom: 20px;
        }
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-size: 13px;
            font-weight: 600;
            color: #444;
            text-transform: uppercase;
        }
        .form-group input {
            width: 100%;
            padding: 12px;
            border: 1px solid #ccc;
            border-radius: 4px;
            font-size: 14px;
            box-sizing: border-box;
            outline: none;
        }
        .form-group input:focus {
            border-color: #9e1b32;
            box-shadow: 0 0 0 3px rgba(158, 27, 50, 0.15);
        }
        .btn-primary {
            background-color: #9e1b32;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 12px;
            width: 100%;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        .btn-primary:hover {
            background-color: #7d1527;
        }
        .footer {
            text-align: center;
            padding: 20px;
            font-size: 12px;
            color: #777;
            background-color: #eee;
        }
    </style>
</head>
<body>
    <div class="header-bar">
        <div class="header-logo">
            <div class="t-badge">T</div>
            TEMPLE UNIVERSITY
        </div>
        <div style="font-size: 13px; opacity: 0.8;">Single Sign-On</div>
    </div>
    
    <div class="container">
        <div class="card">
            <h2>AccessNet Login</h2>
            <p class="subtitle">Log in using your Temple AccessNet username and password.</p>
            
            <div class="alert-demo">
                <strong>Temple SSO Demonstration Portal</strong><br/>
                Enter any AccessNet username (e.g., <code>tux12345</code> or <code>shuv</code>) to sign in.
            </div>
            
            <form id="loginForm">
                <div class="form-group">
                    <label for="username">AccessNet Username</label>
                    <input type="text" id="username" placeholder="tux12345" value="tux99887" required autocomplete="username">
                </div>
                <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" value="password123" required autocomplete="current-password">
                </div>
                <button type="submit" class="btn-primary">Sign In</button>
            </form>
        </div>
    </div>
    
    <div class="footer">
        Temple University single sign-on demonstration. Protected by mock Shibboleth.
    </div>

    <script>
        document.getElementById("loginForm").addEventListener("submit", function(e) {
            e.preventDefault();
            const username = document.getElementById("username").value.trim().toLowerCase();
            const email = username.includes('@') ? username : `${username}@temple.edu`;
            const name = username.split('@')[0];
            
            const urlParams = new URLSearchParams(window.location.search);
            const state = urlParams.get('state') || '';
            
            window.location.href = `/api/auth/temple/callback?code=mock_code&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}&state=${state}`;
        });
    </script>
</body>
</html>
"""
