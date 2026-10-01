# Computer control

Desktop tools for Chat: screenshot, click, type, key, scroll, drag, wait and
release. Enable **Settings → Chat → Write** access and choose a vision-capable
model. Each action returns a screenshot; Chat sends the pixels as image content
with either Responses or a compatible Chat Completions provider.

On Windows the plugin runs a hidden, persistent PowerShell helper using built-in
.NET screen capture and Windows SendInput. No extra package is needed.
Screenshots are at most 1600 pixels wide. Tools use screenshot coordinates; the
helper maps those to physical display coordinates and rejects changed layouts.
Take another screenshot to select a display or wait for an app to finish loading.

`computer_click` accepts an optional `durationMs` (0–10,000; default 50), the
time each mouse button press remains held before release. For a game sampling
input across frames, try 100–250 ms. Double clicks hold each press separately.
Cancellation interrupts the hold and releases the button in a finally block.
This does not bypass games that reject synthetic input.

Action tools also accept `waitMs` (0–10,000; default 800), separate from the
press duration, and an optional `expectedEffect` describing the intended visible
change. After input is released, the tool waits, captures a screenshot and, for
nonzero waits, samples again 250 ms later. Only the final image is returned, so
there is still one tool call. Use 1500–3000 ms for page navigation; use 0 for
low-latency game input. `computer_wait` observes the current display again after
a delay (default 1500 ms) without repeating any input.

Results say `actionStatus: input-sent` and `outcome: unverified`. Image changes
and equal samples are observations, not proof that the intended control opened
or a network request completed. The model must identify visible evidence; if
uncertain, it should wait and inspect again rather than claim success or blindly
repeat a click. This reduces timing mistakes but cannot guarantee semantic
correctness. Browser DOM/accessibility state and URL checks are stronger evidence
for web tasks than pixels alone.

## macOS and Linux

The Python adapter supports macOS and Linux/X11 using MSS, Pillow and pynput.
Create a Python 3 environment, install this plugin's `requirements.txt`, and set
`SISYPHUS_COMPUTER_PYTHON` to that environment's Python executable before starting
Sisyphus. Without an override it uses `python3`. Nothing is installed automatically.
The same coordinate, duration, observation and cancellation rules apply.

On macOS, Screen Recording and Accessibility permissions are required for the
helper/launching app; permission failures are reported for the user to resolve.
Linux needs an interactive X11 session and DISPLAY. Wayland is explicitly
unsupported by this adapter; full support needs a compositor/portal-backed
remote-desktop implementation. These adapters require testing on their target OS;
Windows CI and fake-device tests do not establish macOS/Linux compatibility.

Only one chat reply owns the desktop. Actions require the latest screenshot ID;
parallel actions against an old image are rejected. Stop cancels pending input,
and held keys/buttons are released by the helper. Ownership ends with the reply
or computer_release. Turning off this plugin stops its helper.

This controls the ordinary interactive desktop. Elevated applications,
protected desktops, and some applications that reject synthetic input may not
work. It shares the user's mouse, focus and keyboard; avoid using them during a
computer task. It does not bypass OS permissions.

## Session isolation

The plugin uses the existing desktop by default. A fresh virtual workspace is
not an independent input session. For isolated browser work, use a dedicated
browser context/profile. For independent desktop automation, run the app/helper
inside a dedicated VM or Linux graphical session with its own display. Keep that
environment for the duration of a task so files, sign-ins and app state survive.
Provisioning fresh desktops or VMs is not implemented here.
