"""Bootstrap the monorepo: npm workspace install and the python-host venv.

Usage: python scripts/setup.py
Run once after cloning to install the workspace dependencies and Python API.

"""
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).parent.parent
HOST = BASE / "plugins" / "python" / "service"


def run(args, cwd):
    if sys.platform == "win32" and args[0] == "npm":
        args = ["npm.cmd", *args[1:]]
    print(f"\n$ {' '.join(args)}  (in {cwd})", flush=True)
    subprocess.run(args, cwd=cwd, check=True)


def main():
    run(["npm", "install"], BASE)

    py = HOST / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    if not py.exists():
        print(f"\n[setup] creating venv at {HOST / '.venv'}")
        subprocess.run([sys.executable, "-m", "venv", str(HOST / ".venv")], cwd=HOST, check=True)
    run([str(py), "-m", "pip", "install", "-r", "requirements.txt"], HOST)

    print("\nSetup complete.")


if __name__ == "__main__":
    main()
