import os
import sys
from pathlib import Path
import subprocess

BASE = Path(__file__).parent.parent


def run(args, cwd):
    # On Windows, npm is a .cmd shim; CreateProcess can't resolve the bare
    # name ("npm" alone is an extensionless shell script, also not runnable).
    if os.name == "nt" and args[0] == "npm":
        args = ["npm.cmd", *args[1:]]
    print(f"\n$ {' '.join(args)}  (in {cwd})", flush=True)
    result = subprocess.run(args, cwd=cwd)  # stream output live; no capture
    if result.returncode != 0:
        print(f"FAILED (exit code {result.returncode})", file=sys.stderr)
        sys.exit(result.returncode)


def main():
    run(["npm", "run", "build"], BASE / "apps" / "frontend")
    run(["npm", "start"], BASE / "apps" / "desktop")


if __name__ == "__main__":
    main()
