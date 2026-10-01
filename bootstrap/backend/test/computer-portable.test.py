"""Portable input tests with fake devices: never inject into the host desktop."""
import importlib.util
import pathlib
import unittest
from unittest.mock import patch

source = pathlib.Path(__file__).resolve().parents[3] / 'plugins/computer/backend/lib/portable.py'
spec = importlib.util.spec_from_file_location('portable', source)
portable = importlib.util.module_from_spec(spec)
spec.loader.exec_module(portable)


class Device:
    def __init__(self):
        self.events = []

    def press(self, key):
        self.events.append(('down', key))

    def release(self, key):
        self.events.append(('up', key))


class Keys:
    left = 'left'
    ctrl = 'ctrl'
    cmd = 'cmd'


class PortableTests(unittest.TestCase):
    def setUp(self):
        self.device = Device()
        self.request = {'action': 'click', 'x': 400, 'y': 300, 'durationMs': 250, 'count': 2,
                        'frame': {'width': 800, 'height': 600, 'screenWidth': 1600, 'screenHeight': 1200, 'left': -1600, 'top': 0}}

    def test_duration_and_coordinates(self):
        with patch.object(portable, 'wait') as wait:
            portable.perform(self.request, self.device, self.device, Keys, Keys)
        self.assertEqual(self.device.position, (-800, 600))
        self.assertEqual(self.device.events, [('down', 'left'), ('up', 'left')] * 2)
        self.assertEqual([call.args[0] for call in wait.call_args_list], [250, 70, 250])

    def test_cancel_releases_button(self):
        with patch.object(portable, 'wait', side_effect=RuntimeError('stopped')):
            with self.assertRaisesRegex(RuntimeError, 'stopped'):
                portable.perform(self.request, self.device, self.device, Keys, Keys)
        self.assertEqual(self.device.events, [('down', 'left'), ('up', 'left')])

    def test_validate_all_keys_before_input(self):
        with self.assertRaisesRegex(ValueError, 'Unsupported key'):
            portable.perform({'action': 'key', 'keys': ['CTRL', 'nonsense']}, self.device, self.device, Keys, Keys)
        self.assertEqual(self.device.events, [])
        self.assertEqual(portable.key_code('CMD', Keys), 'cmd')

    def test_out_of_bounds_never_presses(self):
        self.request['x'] = 800
        with self.assertRaisesRegex(ValueError, 'outside'):
            portable.perform(self.request, self.device, self.device, Keys, Keys)
        self.assertEqual(self.device.events, [])


if __name__ == '__main__':
    unittest.main()
