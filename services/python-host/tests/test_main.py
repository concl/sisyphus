from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["service"] == "python-host"


def test_info():
    res = client.get("/api/info")
    assert res.status_code == 200
    body = res.json()
    assert body["service"] == "python-host"
    assert "python" in body
    assert "time" in body
