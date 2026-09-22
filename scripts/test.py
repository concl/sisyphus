"""Run lifecycle, native service, UI registry, and Python API tests."""
import subprocess
import sys
from pathlib import Path
BASE = Path(__file__).resolve().parent.parent
if __name__ == '__main__':
    subprocess.run(['npm.cmd' if sys.platform == 'win32' else 'npm', 'test'], cwd=BASE, check=True)
    host = BASE / 'plugins/python/service'
    python = host / '.venv' / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
    if not python.exists():
        raise SystemExit('Run python scripts/setup.py to create the Python environment first.')
    subprocess.run([str(python), '-m', 'pytest', '-q'], cwd=host, check=True)
