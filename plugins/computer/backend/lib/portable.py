"""JSON-lines desktop helper for macOS and Linux/X11. No shell evaluation."""
import base64
import ctypes
import io
import json
import os
import sys
import time


def check(cancel_file):
    if cancel_file and os.path.exists(cancel_file):
        raise RuntimeError("Request stopped")


def wait(milliseconds, cancel_file):
    deadline = time.monotonic() + milliseconds / 1000
    while time.monotonic() < deadline:
        check(cancel_file)
        time.sleep(min(.02, max(0, deadline - time.monotonic())))
    check(cancel_file)


def point(frame, x, y):
    if not (0 <= x < frame['width'] and 0 <= y < frame['height']):
        raise ValueError('Point is outside the screenshot.')
    return (frame['left'] + int(x * frame['screenWidth'] / frame['width']),
            frame['top'] + int(y * frame['screenHeight'] / frame['height']))


def key_code(name, key):
    aliases = {'CTRL': 'ctrl', 'SHIFT': 'shift', 'ALT': 'alt', 'WIN': 'cmd',
               'CMD': 'cmd', 'ENTER': 'enter', 'TAB': 'tab', 'ESC': 'esc',
               'SPACE': 'space', 'BACKSPACE': 'backspace', 'DELETE': 'delete',
               'HOME': 'home', 'END': 'end', 'PAGEUP': 'page_up', 'PAGEDOWN': 'page_down',
               'LEFT': 'left', 'RIGHT': 'right', 'UP': 'up', 'DOWN': 'down'}
    name = name.upper()
    if len(name) == 1 and name.isascii() and name.isalnum():
        return name.lower()
    if name.startswith('F') and name[1:].isdigit() and 1 <= int(name[1:]) <= 12:
        return getattr(key, name.lower())
    if name not in aliases:
        raise ValueError('Unsupported key: ' + name)
    return getattr(key, aliases[name])


def perform(request, mouse, keyboard, button_type, key_type):
    """Separate input from capture; every held input is released on cancellation."""
    action = request['action']
    frame = request.get('frame')
    cancel_file = request.get('cancelFile')
    check(cancel_file)
    if action in ('click', 'scroll', 'drag'):
        start = point(frame, request['x'], request['y'])
        end = point(frame, request['toX'], request['toY']) if action == 'drag' else None
        mouse.position = start
    if action == 'click':
        duration = request.get('durationMs', 50)
        if not 0 <= duration <= 10000:
            raise ValueError('durationMs must be between 0 and 10000.')
        button = getattr(button_type, request.get('button', 'left'))
        for index in range(request.get('count', 1)):
            check(cancel_file)
            try:
                mouse.press(button)
                wait(duration, cancel_file)
            finally:
                mouse.release(button)
            if index + 1 < request.get('count', 1):
                wait(70, cancel_file)
    elif action == 'type':
        for character in request['text']:
            check(cancel_file)
            keyboard.type(character)
    elif action == 'key':
        keys = [key_code(name, key_type) for name in request['keys']]
        held = []
        try:
            for key in keys:
                check(cancel_file)
                keyboard.press(key)
                held.append(key)
        finally:
            for key in reversed(held):
                keyboard.release(key)
    elif action == 'scroll':
        mouse.scroll(0, request['amount'])
    elif action == 'drag':
        try:
            mouse.press(button_type.left)
            for step in range(1, 16):
                check(cancel_file)
                mouse.position = tuple(round(a + (b-a)*step/15) for a, b in zip(start, end))
                wait(20, cancel_file)
        finally:
            mouse.release(button_type.left)
    else:
        raise ValueError('Unknown desktop action: ' + action)


def permissions():
    if sys.platform == 'linux':
        if os.environ.get('WAYLAND_DISPLAY') or os.environ.get('XDG_SESSION_TYPE') == 'wayland':
            raise RuntimeError('This backend requires Linux X11. Wayland is not supported.')
        if not os.environ.get('DISPLAY'):
            raise RuntimeError('No X11 DISPLAY. Run Sisyphus inside an interactive X11 desktop session.')
    elif sys.platform == 'darwin':
        graphics = ctypes.CDLL('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
        if hasattr(graphics, 'CGPreflightScreenCaptureAccess'):
            graphics.CGPreflightScreenCaptureAccess.restype = ctypes.c_bool
            if not graphics.CGPreflightScreenCaptureAccess():
                raise RuntimeError('Screen Recording access is required for the Python helper/launching app in macOS System Settings. Grant it yourself and restart the helper.')
        services = ctypes.CDLL('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices')
        services.AXIsProcessTrusted.restype = ctypes.c_bool
        if not services.AXIsProcessTrusted():
            raise RuntimeError('Accessibility access is required for the Python helper/launching app in macOS System Settings. Grant it yourself and restart the helper.')


class PortableDesktop:
    def __init__(self):
        permissions()
        try:
            import mss
            from PIL import Image
            from pynput import mouse, keyboard
        except ImportError as error:
            raise RuntimeError('Install the computer plugin requirements.txt in a Python 3 environment and set SISYPHUS_COMPUTER_PYTHON to its executable. ' + str(error)) from error
        self.mss, self.Image = mss, Image
        self.mouse, self.keyboard = mouse.Controller(), keyboard.Controller()
        self.Button, self.Key = mouse.Button, keyboard.Key

    def execute(self, request):
        permissions()
        check(request.get('cancelFile'))
        # A fresh MSS instance refreshes monitor geometry after hot-plug changes.
        with self.mss.mss() as capture:
            monitors = capture.monitors[1:]
            frame = request.get('frame')
            display = request.get('display', 0) if request['action'] == 'screenshot' else frame['display']
            if not 0 <= display < len(monitors):
                raise ValueError('Display is no longer available.')
            bounds = monitors[display]
            if request['action'] != 'screenshot':
                if any(bounds[key] != frame[field] for key, field in [('left', 'left'), ('top', 'top'), ('width', 'screenWidth'), ('height', 'screenHeight')]):
                    raise ValueError('Display layout changed. Take another screenshot.')
                perform(request, self.mouse, self.keyboard, self.Button, self.Key)
                if request.get('capture') is False:
                    return {'inputSent': True}
            check(request.get('cancelFile'))
            shot = capture.grab(bounds)
            picture = self.Image.frombytes('RGB', shot.size, shot.rgb)
            picture.thumbnail((1600, 10000), self.Image.Resampling.LANCZOS)
            stream = io.BytesIO()
            picture.save(stream, format='PNG')
            return {'image': base64.b64encode(stream.getvalue()).decode('ascii'),
                    'display': display, 'displays': [{'display': i, 'name': 'Display ' + str(i+1)} for i in range(len(monitors))],
                    'width': picture.width, 'height': picture.height, 'left': bounds['left'], 'top': bounds['top'],
                    'screenWidth': bounds['width'], 'screenHeight': bounds['height']}


def main():
    desktop = None
    for line in sys.stdin:
        try:
            request = json.loads(line)
            check(request.get('cancelFile'))
            if desktop is None:
                desktop = PortableDesktop()
            result = desktop.execute(request)
        except Exception as error:
            result = {'error': str(error)}
        print(json.dumps(result, ensure_ascii=True), flush=True)


if __name__ == '__main__':
    main()
