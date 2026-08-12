"""Sisyphus python-host: a small FastAPI service managed by the Electron app.

The desktop main process spawns this service (uvicorn) on startup,
health-checks it, and kills it on quit. The frontend reaches it through the
`service:*` IPC channels, which the main process proxies to this HTTP API.
"""

from __future__ import annotations

import platform
import sys
from datetime import datetime, timezone

from fastapi import FastAPI

app = FastAPI(title="Sisyphus python-host", version="0.0.0")


@app.get("/health")
def health() -> dict:
    """Liveness endpoint used by the Electron process supervisor."""
    return {"status": "ok", "service": "python-host"}


@app.get("/api/info")
def info() -> dict:
    """Sample data endpoint, demonstrating the renderer -> main -> service flow."""
    return {
        "service": "python-host",
        "python": platform.python_version(),
        "platform": platform.platform(),
        "time": datetime.now(timezone.utc).isoformat(),
        "executable": sys.executable,
    }
