"""Build and launch the desktop app."""
import subprocess
import sys
from pathlib import Path
BASE = Path(__file__).resolve().parent.parent
if __name__ == '__main__':
    subprocess.run([sys.executable, str(BASE / 'scripts/build.py')], cwd=BASE, check=True)
    subprocess.run(['npm.cmd' if sys.platform == 'win32' else 'npm', 'start'], cwd=BASE, check=True)
