"""Cron / admin job secret gate."""
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from cron_auth import require_cron_secret


def _app() -> FastAPI:
    app = FastAPI()

    @app.get("/job")
    async def job(request: Request):
        require_cron_secret(request)
        return {"ok": True}

    return app


def test_job_503_when_secret_unset(monkeypatch):
    monkeypatch.delenv("CRON_JOB_SECRET", raising=False)
    monkeypatch.delenv("ADMIN_JOB_SECRET", raising=False)
    r = TestClient(_app()).get("/job")
    assert r.status_code == 503


def test_job_401_wrong_secret(monkeypatch):
    monkeypatch.setenv("CRON_JOB_SECRET", "correct-secret")
    r = TestClient(_app()).get("/job", headers={"X-Cron-Secret": "nope"})
    assert r.status_code == 401


def test_job_ok_header(monkeypatch):
    monkeypatch.setenv("CRON_JOB_SECRET", "correct-secret")
    r = TestClient(_app()).get("/job", headers={"X-Cron-Secret": "correct-secret"})
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_job_ok_bearer(monkeypatch):
    monkeypatch.setenv("CRON_JOB_SECRET", "correct-secret")
    r = TestClient(_app()).get("/job", headers={"Authorization": "Bearer correct-secret"})
    assert r.status_code == 200


def test_named_secret_pos_header(monkeypatch):
    from cron_auth import require_env_secret

    app = FastAPI()

    @app.post("/pos")
    async def pos(request: Request):
        require_env_secret(
            request,
            "POS_WEBHOOK_SECRET",
            header="x-pos-webhook-secret",
            missing_detail="missing",
            bad_detail="bad",
        )
        return {"ok": True}

    monkeypatch.setenv("POS_WEBHOOK_SECRET", "pos-secret")
    client = TestClient(app)
    assert client.post("/pos").status_code == 401
    r = client.post("/pos", headers={"X-Pos-Webhook-Secret": "pos-secret"})
    assert r.status_code == 200
