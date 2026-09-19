# Chat plugin

`src/` owns the conversation UI and per-conversation streaming store. `native/`
owns provider configuration, the Electron adapter, worker RPC, history, model
loops, and the default prompt. Cross-feature tools come from `agent.tools.v1`.

Multiple conversations may run concurrently; one conversation has one active run.
Switching views does not cancel work. The worker stores every SDK response step,
including tool messages and supported reasoning metadata. The context indicator
uses provider input/output usage or explicitly labeled estimates.

Edit the installed source folder and reload from Plugin studio, or use
`npm run plugins:watch` to sync repository edits. Reloading the native adapter
cancels its runs; ordinary UI navigation does not. See the repository's
[architecture](../../ARCHITECTURE.md) for lifecycle and persistence contracts.
