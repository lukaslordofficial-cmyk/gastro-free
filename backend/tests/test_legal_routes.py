from fastapi import FastAPI
from fastapi.testclient import TestClient

from legal_routes import router


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    return app


def test_privacy_and_terms_html():
    c = TestClient(_app())
    p = c.get("/privacy")
    t = c.get("/terms")
    assert p.status_code == 200
    assert t.status_code == 200
    assert "text/html" in p.headers.get("content-type", "")
    assert "Polityka prywatności" in p.text
    assert "Usuń konto" in p.text
    assert "Regulamin" in t.text
    assert c.get("/api/privacy").status_code == 200
    assert c.get("/api/terms").status_code == 200
