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

## Isolated desktop

Sisyphus can keep Chat on the host and send computer screenshots and input through
an existing Windows VM. The VM keeps its own applications, desktop, and sign-ins.
Chat's file and shell tools still use the host conversation folder.

1. Set up [OpenSSH Server](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse)
   with [key authentication](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement)
   in the VM. Configure the host's OpenSSH client with a host name or SSH config
   alias for the VM, verify the VM's host key, and confirm that the host can
   connect without prompting. The server must allow local TCP forwarding to
   `127.0.0.1:47631` in the guest.
2. Copy the `computer` plugin folder into the VM. From that folder, in a
   PowerShell window on the signed-in VM desktop with Node.js installed, run
   `node backend/lib/vm-guest.js`. Keep that window open and the guest desktop
   unlocked. The helper listens only on the guest loopback interface. Retrieve
   the pairing token with `node backend/lib/vm-guest.js --show-token` in a
   separate terminal under the same Windows account. Close the terminal showing
   the token before using computer tools. The token persists across restarts.
3. In host Sisyphus, open **Settings → Chat → Computer use**. Enter the VM SSH
   host and pairing token, turn on **Use an isolated desktop**, and save. The
   token is stored encrypted on the host. Clear the checkbox and save to use
   the host desktop again.

When the VM connection fails, computer tools report the error. Start or
reconnect the guest helper, then take a new screenshot before sending input.
