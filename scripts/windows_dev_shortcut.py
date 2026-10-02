"""Put the development build of this checkout on the Windows Desktop.

Usage:
    python scripts/dev_shortcut.py                the entry, on the Desktop
    python scripts/dev_shortcut.py --menu         also in the Start menu
    python scripts/dev_shortcut.py --startup      also run it when you log in
    python scripts/dev_shortcut.py --print        say what would be written, write nothing
    python scripts/dev_shortcut.py --remove       take the entries away again
    python scripts/dev_shortcut.py --name=NAME    call it something else

The entry runs scripts/build_and_run_desktop.py, so every launch rebuilds the app and
then starts it: the loop you want while working on the app itself. `npm run shortcut`
writes the other kind of entry, which opens the build that is already there and builds
nothing. A console window stays open with the build log while the app runs; closing the
app closes it.

Windows only, because it writes .lnk files. The entry points into this checkout, so move
the folder and run this again. The icon is bootstrap/backend/build/icon.ico when that
file exists (run `npm run shortcut` once to draw it), otherwise the checkout's Electron.
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
RUN_DEV = BASE / 'scripts' / 'build_and_run_desktop.py'
MANIFEST = BASE / 'bootstrap' / 'backend' / 'package.json'
ICON = BASE / 'bootstrap' / 'backend' / 'build' / 'icon.ico'
ELECTRON = BASE / 'bootstrap' / 'backend' / 'node_modules' / 'electron' / 'dist' / 'electron.exe'


def quote(value):
    """A single-quoted PowerShell string."""
    return "'" + str(value).replace("'", "''") + "'"


def powershell(script):
    """Run a short script in a fresh PowerShell, so no shell profile gets in the way."""
    folder = Path(tempfile.mkdtemp(prefix='sisyphus-shortcut-'))
    file = folder / 'entry.ps1'
    # utf-8-sig: Windows PowerShell reads a BOM-less file as ANSI, which would mangle
    # a path with non-ASCII characters in it.
    file.write_text("$ErrorActionPreference = 'Stop'\n" + script + '\n', encoding='utf-8-sig')
    try:
        result = subprocess.run(
            ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(file)]
        )
        if result.returncode != 0:
            raise SystemExit('dev_shortcut: powershell could not write the entry')
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def shell_folder(which):
    """The real Desktop, Start menu, or Startup folder, wherever this system keeps it."""
    result = subprocess.run(
        ['powershell.exe', '-NoProfile', '-Command', f"[Environment]::GetFolderPath('{which}')"],
        capture_output=True, text=True,
    )
    value = result.stdout.strip()
    if not value:
        raise SystemExit(f'dev_shortcut: could not find the {which} folder')
    return Path(value)


def default_name():
    """Named apart from the `npm run shortcut` entry, so neither overwrites the other."""
    product = None
    try:
        product = json.loads(MANIFEST.read_text(encoding='utf-8')).get('productName')
    except (OSError, ValueError):
        pass
    return f'{product or "Sisyphus"} Dev'


def possible_entries(name):
    return [
        shell_folder('Desktop') / f'{name}.lnk',
        shell_folder('Programs') / f'{name}.lnk',
        shell_folder('Startup') / f'{name}.lnk',
    ]


def icon_for_entry():
    if ICON.exists():
        return ICON
    # An entry can take an executable's own icon, and this checkout has one.
    return ELECTRON if ELECTRON.exists() else None


def remove(possible, dry_run):
    found = [file for file in possible if file.exists()]
    if found and not dry_run:
        powershell(f"""foreach ($file in @({', '.join(quote(f) for f in found)})) {{
  Remove-Item -LiteralPath $file -Force
}}""")


def create(name, files, icon, dry_run):
    if dry_run:
        return
    powershell(f"""$shell = New-Object -ComObject WScript.Shell
foreach ($file in @({', '.join(quote(f) for f in files)})) {{
  $link = $shell.CreateShortcut($file)
  $link.TargetPath = {quote(sys.executable)}
  $link.Arguments = {quote(f'"{RUN_DEV}"')}
  $link.WorkingDirectory = {quote(BASE)}
  $link.Description = {quote(f'{name} - development build, rebuilds on launch')}
  {'$link.IconLocation = ' + quote(f'{icon},0') if icon else ''}
  $link.Save()
}}""")


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--menu', action='store_true', help='also put the entry in the Start menu')
    parser.add_argument('--startup', action='store_true', help='also run it when you log in')
    parser.add_argument(
        '--print', dest='dry_run', action='store_true',
        help='say what would be written, write nothing',
    )
    parser.add_argument('--remove', action='store_true', help='take the entries away again')
    parser.add_argument('--name', default=default_name(), help='call it something else')
    args = parser.parse_args()

    if sys.platform != 'win32':
        raise SystemExit('dev_shortcut: Windows only; it writes .lnk entries')
    if not RUN_DEV.exists():
        raise SystemExit(f'dev_shortcut: nothing to run at {RUN_DEV}')

    desktop, menu, startup = possible_entries(args.name)

    if args.remove:
        remove([desktop, menu, startup], args.dry_run)
        print(f'{args.name}: entry removed')
        for file in (desktop, menu, startup):
            print(f"  {'still there' if file.exists() else 'gone'}  {file}")
        return

    files = [desktop]
    if args.menu:
        files.append(menu)
    if args.startup:
        files.append(startup)
    icon = icon_for_entry()
    create(args.name, files, icon, args.dry_run)

    print(f'{args.name}{" (nothing written: --print)" if args.dry_run else ""}')
    print(f'  runs     "{sys.executable}" "{RUN_DEV}"')
    print(f'  in       {BASE}')
    print(f'  icon     {icon or "the system\'s own"}')
    for file in files:
        print(f'  entry    {file}')
    print('  to pin   right-click it, Show more options, Pin to taskbar')
    if not args.startup:
        print('  at login python scripts/dev_shortcut.py --startup')


if __name__ == '__main__':
    main()
