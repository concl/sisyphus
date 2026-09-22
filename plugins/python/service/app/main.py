"""Sisyphus python-host: a small FastAPI service managed by the Electron app.

The desktop Python plugin starts this ASGI app on demand through runner.py,
health-checks it, and stops it when the plugin unloads or the app quits.
The frontend reaches its API through the plugin's validated IPC proxy.
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
