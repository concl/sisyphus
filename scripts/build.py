"""Build the desktop renderer; optionally package the application."""
import argparse
import subprocess
import sys
from pathlib import Path
BASE = Path(__file__).resolve().parent.parent

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', action='store_true')
    args = parser.parse_args()
    subprocess.run(['npm.cmd' if sys.platform == 'win32' else 'npm', 'run', 'build'], cwd=BASE, check=True)
    if args.package:
        subprocess.run([sys.executable, str(BASE / 'scripts/package.py')], cwd=BASE, check=True)

if __name__ == '__main__':
    main()
