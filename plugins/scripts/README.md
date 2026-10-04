# Script execution

`scripts.v1` owns process execution independently of Actions and automation.
`run({ program, args, cwd, stdin, detach, timeoutSeconds }, { signal, log })`
starts an executable with literal arguments and returns `{ stdout, stderr,
exitCode }`. `runScript({ interpreter, path, ...settings }, context)` inserts
the absolute script path before the arguments. An interpreter can be Python,
PowerShell, Node, or another executable; the service does not own Python servers.

The optional `desktop.script-actions` adapter exposes these methods in the action
catalog. Disabling automation leaves script execution available. Unloading the
script service cancels attached processes; detached processes keep running.
Output is bounded to the latest 32,000 characters per stream. Nonzero exits,
timeouts, and launch errors reject the call.
