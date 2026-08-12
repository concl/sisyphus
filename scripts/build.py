"""Build the distributable artifacts.

Usage: python scripts/build.py [--package]
- default: build @sisyphus/shared, then the frontend bundle.
- --package: additionally package the desktop app with electron-builder
  (requires the frontend build above; see "Packaging & distribution").
"""
import argparse
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", action="store_true", help="also package the desktop app")
    args = parser.parse_args()

    run(["npm", "-w", "@sisyphus/shared", "run", "build"], BASE)
    run(["npm", "run", "build"], BASE / "apps" / "frontend")

    if args.package:
        run(["python", str(BASE / "scripts" / "package.py")], BASE)

    print("\nBuild complete.")


if __name__ == "__main__":
    main()
