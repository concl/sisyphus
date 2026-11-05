# Terminal

The Terminal plugin registers one workspace panel. Opening Terminal from the
sidebar focuses that panel. Shell sessions appear in a compact vertical list on
the right, following VS Code's terminal layout. Select **+** to create a terminal
using the last selected shell, or open the arrow menu beside it to create a
terminal with a different shell. The menu supports arrow keys and Escape.
Existing sessions keep their shells. Restart and close actions are icons in the
toolbar; each session also has a close icon that appears on hover or focus.

The first visit opens one default shell. Closing the last tab leaves the panel
empty until another terminal is opened. Tabs keep their process and scrollback
when switching sessions, opening another workspace panel, or closing and reopening
the Terminal panel. **Restart terminal** replaces only the selected session.
Closing a tab stops its process. Reloading/disabling the plugin or closing the app
stops all its sessions; sessions are not restored after an app restart.

The shell picker lists shells detected by the terminal backend: on Windows this
includes Windows PowerShell and Command Prompt, plus PowerShell 7, Git Bash, and
WSL when available. Shell detection and PTY process handling remain in
`backend/terminal.js`; agent shell commands remain a separate service.

- `frontend/index.tsx`: plugin registration and lifetime.
- `frontend/store.ts`: tab state, selection, shell choices, and session ownership.
- `frontend/session.ts`: xterm, PTY events, resizing, and cleanup.
- `frontend/terminal-panel.tsx`: toolbar, vertical tabs, and terminal surfaces.
- `frontend/terminal.css`: terminal-specific styles.

The workspace removes duplicate singleton panels from older saved layouts,
preferring the active panel. This also applies when a plugin changes from allowing
multiple panels to registering a single panel.
