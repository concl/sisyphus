"""Run all unit tests: frontend (vitest), desktop (node:test), python-host (pytest).

Usage: python scripts/test.py
Requires setup.py to have been run (npm deps + python-host venv).
"""
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).parent.parent


def run(args, cwd):
    if sys.platform == "win32" and args[0] == "npm":
        args = ["npm.cmd", *args[1:]]
    print(f"\n$ {' '.join(args)}  (in {cwd})", flush=True)
    subprocess.run(args, cwd=cwd, check=True)


def main():
    run(["npm", "run", "test"], BASE / "apps" / "frontend")
    run(["npm", "test"], BASE / "apps" / "desktop")

    py = BASE / "services" / "python-host" / ".venv" / (
        "Scripts/python.exe" if sys.platform == "win32" else "bin/python"
    )
    if not py.exists():
        print("\npython-host venv missing; run scripts/setup.py first", file=sys.stderr)
        sys.exit(1)
    run([str(py), "-m", "pytest", "-q"], BASE / "services" / "python-host")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
