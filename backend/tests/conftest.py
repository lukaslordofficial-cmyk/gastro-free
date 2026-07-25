import os
import pytest
import requests

# Prefer public URL from frontend/.env if available; fall back to local backend.
def _resolve_base_url() -> str:
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
    if not url:
        try:
            with open("/app/frontend/.env", "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except Exception:
            pass
    if not url:
        url = "http://localhost:8001"
    return url.rstrip("/")

BASE_URL = _resolve_base_url()

@pytest.fixture(scope="session")
def base_url() -> str:
    return BASE_URL

@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s
