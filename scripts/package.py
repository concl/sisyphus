"""Package the desktop app into an installer via electron-builder.

Usage: python scripts/package.py
Requires the frontend build (scripts/build.py) and npm deps (scripts/setup.py).
The built installer lands in apps/desktop/dist/.
"""
import shutil
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).parent.parent
DESKTOP = BASE / "apps" / "desktop"
FRONTEND_DIST = BASE / "apps" / "frontend" / "dist"
STAGED = DESKTOP / "frontend-dist"


def run(args, cwd):
    if sys.platform == "win32" and args[0] == "npm":
        args = ["npm.cmd", *args[1:]]
    print(f"\n$ {' '.join(args)}  (in {cwd})", flush=True)
    subprocess.run(args, cwd=cwd, check=True)


def main():
    if not (FRONTEND_DIST / "index.html").exists():
        print("frontend build not found; run scripts/build.py first", file=sys.stderr)
        sys.exit(1)

    # Stage the frontend bundle inside the desktop app so main.js can find it
    # in the packaged app (see resolveFrontendIndex in main.js).
    if STAGED.exists():
        shutil.rmtree(STAGED)
    shutil.copytree(FRONTEND_DIST, STAGED)
    print(f"[package] staged frontend bundle at {STAGED}")

    run(["npm", "run", "package"], DESKTOP)
    print(f"\nPackaged app written to {DESKTOP / 'dist'}")


if __name__ == "__main__":
    main()
