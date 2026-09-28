# Computer control

Windows desktop tools for Chat: screenshot, click, type, key, scroll, drag and
release. Enable **Settings → Chat → Write** access and choose a vision-capable
model. Each action returns a screenshot; Chat sends the pixels as image content
with either Responses or a compatible Chat Completions provider.

The plugin runs a hidden, persistent Windows PowerShell helper using built-in
.NET screen capture and Windows SendInput. No extra package is installed.
Screenshots are at most 1600 pixels wide. Tools use screenshot coordinates; the
helper maps those to physical display coordinates and rejects changed layouts.
Take another screenshot to select a display or wait for an app to finish loading.

Only one chat reply owns the desktop. Actions require the latest screenshot ID;
parallel actions against an old image are rejected. Stop cancels pending input,
and held keys/buttons are released by the helper. Ownership ends with the reply
or computer_release. Turning off this plugin stops its helper.

This controls the ordinary interactive Windows desktop. Elevated applications,
protected desktops, and some applications that reject synthetic input may not
work. It shares the user's mouse, focus and keyboard; avoid using them during a
computer task. It does not bypass Windows permissions.
