import os
import re
import time
import secrets
import logging
from typing import Optional, Tuple
from datetime import datetime

import jwt
import requests
from fastapi import HTTPException

logger = logging.getLogger(__name__)

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
APPLE_CLIENT_ID = os.getenv("APPLE_CLIENT_ID", "")
APPLE_TEAM_ID = os.getenv("APPLE_TEAM_ID", "")
APPLE_KEY_ID = os.getenv("APPLE_KEY_ID", "")
APPLE_PRIVATE_KEY = os.getenv("APPLE_PRIVATE_KEY", "").replace("\\n", "\n")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
APPLE_REDIRECT_URI = os.getenv(
    "APPLE_REDIRECT_URI", "http://localhost:8000/auth/apple/callback"
)

_oauth_states: dict[str, float] = {}
STATE_TTL_SECONDS = 600


def oauth_providers_status() -> dict:
    return {
        "google": bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET),
        "apple": bool(
            APPLE_CLIENT_ID and APPLE_TEAM_ID and APPLE_KEY_ID and APPLE_PRIVATE_KEY
        ),
    }


def _cleanup_states() -> None:
    now = time.time()
    expired = [key for key, created in _oauth_states.items() if now - created > STATE_TTL_SECONDS]
    for key in expired:
        _oauth_states.pop(key, None)


def create_oauth_state() -> str:
    _cleanup_states()
    state = secrets.token_urlsafe(32)
    _oauth_states[state] = time.time()
    return state


def validate_oauth_state(state: Optional[str]) -> None:
    if not state or state not in _oauth_states:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
    _oauth_states.pop(state, None)


def verify_google_id_token(id_token: str) -> dict:
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")

    response = requests.get(
        "https://oauth2.googleapis.com/tokeninfo",
        params={"id_token": id_token},
        timeout=10,
    )
    if not response.ok:
        raise HTTPException(status_code=401, detail="Invalid Google sign-in token")

    payload = response.json()
    audience = payload.get("aud") or payload.get("azp")
    if audience != GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=401, detail="Google token audience mismatch")

    email_verified = payload.get("email_verified")
    if str(email_verified).lower() != "true":
        raise HTTPException(status_code=401, detail="Google email is not verified")

    email = payload.get("email")
    if not email:
        raise HTTPException(status_code=401, detail="Google account email missing")

    return {
        "email": email.lower(),
        "name": payload.get("name") or email.split("@")[0],
        "sub": payload.get("sub"),
        "picture": payload.get("picture"),
    }


def get_google_auth_url() -> str:
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")

    state = create_oauth_state()
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": os.getenv(
            "GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/google/callback"
        ),
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "prompt": "select_account",
        "state": state,
    }
    return requests.Request(
        "GET", "https://accounts.google.com/o/oauth2/v2/auth", params=params
    ).prepare().url


def exchange_google_code(code: str) -> dict:
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")

    redirect_uri = os.getenv(
        "GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/google/callback"
    )
    token_response = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        },
        timeout=10,
    )
    if not token_response.ok:
        logger.error("Google token exchange failed: %s", token_response.text)
        raise HTTPException(status_code=401, detail="Google sign-in failed")

    id_token = token_response.json().get("id_token")
    if not id_token:
        raise HTTPException(status_code=401, detail="Google sign-in failed")
    return verify_google_id_token(id_token)


def _generate_apple_client_secret() -> str:
    if not all([APPLE_TEAM_ID, APPLE_CLIENT_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY]):
        raise HTTPException(status_code=503, detail="Apple sign-in is not configured")

    headers = {"kid": APPLE_KEY_ID, "alg": "ES256"}
    payload = {
        "iss": APPLE_TEAM_ID,
        "iat": int(time.time()),
        "exp": int(time.time()) + 86400 * 150,
        "aud": "https://appleid.apple.com",
        "sub": APPLE_CLIENT_ID,
    }
    return jwt.encode(payload, APPLE_PRIVATE_KEY, algorithm="ES256", headers=headers)


def get_apple_auth_url() -> str:
    if not oauth_providers_status()["apple"]:
        raise HTTPException(status_code=503, detail="Apple sign-in is not configured")

    state = create_oauth_state()
    params = {
        "client_id": APPLE_CLIENT_ID,
        "redirect_uri": APPLE_REDIRECT_URI,
        "response_type": "code id_token",
        "response_mode": "form_post",
        "scope": "name email",
        "state": state,
    }
    return requests.Request(
        "GET", "https://appleid.apple.com/auth/authorize", params=params
    ).prepare().url


def verify_apple_id_token(id_token: str) -> dict:
    if not APPLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Apple sign-in is not configured")

    try:
        from jwt import PyJWKClient

        jwk_client = PyJWKClient("https://appleid.apple.com/auth/keys")
        signing_key = jwk_client.get_signing_key_from_jwt(id_token)
        payload = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=APPLE_CLIENT_ID,
            issuer="https://appleid.apple.com",
        )
    except Exception as exc:
        logger.error("Apple token verification failed: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid Apple sign-in token") from exc

    email = payload.get("email")
    if not email:
        raise HTTPException(status_code=401, detail="Apple account email missing")

    return {
        "email": email.lower(),
        "name": email.split("@")[0],
        "sub": payload.get("sub"),
        "picture": None,
    }


def exchange_apple_code(code: str) -> dict:
    client_secret = _generate_apple_client_secret()
    token_response = requests.post(
        "https://appleid.apple.com/auth/token",
        data={
            "client_id": APPLE_CLIENT_ID,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": APPLE_REDIRECT_URI,
        },
        timeout=10,
    )
    if not token_response.ok:
        logger.error("Apple token exchange failed: %s", token_response.text)
        raise HTTPException(status_code=401, detail="Apple sign-in failed")

    id_token = token_response.json().get("id_token")
    if not id_token:
        raise HTTPException(status_code=401, detail="Apple sign-in failed")
    return verify_apple_id_token(id_token)


def sanitize_username(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_]", "", value.lower())[:20]
    return cleaned or "user"


def build_oauth_password_hash(provider: str, oauth_sub: str) -> str:
    import hashlib

    return hashlib.sha256(f"oauth:{provider}:{oauth_sub}".encode()).hexdigest()


def get_or_create_oauth_user(
    conn,
    email: str,
    name: str,
    provider: str,
    oauth_sub: str,
) -> Tuple[str, bool]:
    existing = conn.execute(
        "SELECT username, email FROM users WHERE email = ? OR oauth_sub = ?",
        (email, oauth_sub),
    ).fetchone()
    if existing:
        conn.execute(
            "UPDATE users SET auth_provider = ?, oauth_sub = ? WHERE username = ?",
            (provider, oauth_sub, existing["username"]),
        )
        conn.commit()
        return existing["username"], False

    base_username = sanitize_username(name or email.split("@")[0])
    username = base_username
    suffix = 1
    while conn.execute(
        "SELECT 1 FROM users WHERE username = ?", (username,)
    ).fetchone():
        username = f"{base_username}{suffix}"
        suffix += 1

    conn.execute(
        """
        INSERT INTO users (username, email, password_hash, auth_provider, oauth_sub, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            username,
            email,
            build_oauth_password_hash(provider, oauth_sub),
            provider,
            oauth_sub,
            datetime.now().isoformat(),
        ),
    )
    conn.commit()
    return username, True
