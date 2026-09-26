# Chat plugin

`frontend/` owns the conversation UI, the per-conversation streaming store, and
the conversation sidebar. `backend/` owns Electron integration, encrypted
provider keys, and tool access checks, together with the worker: `WorkerChat`
(`backend/worker-client.js`) starts `backend/worker.js` through
`runtime.workers.v1`, and the worker holds the model loops, the message tree,
per-conversation history files, and the default system prompt
(`backend/prompts/chat-system.md`). Cross-feature tools come from
`agent.tools.v1`.

Multiple conversations may run concurrently; one conversation has one active run.
Switching views does not cancel work. The worker stores every SDK response step,
including tool messages and supported reasoning metadata. The context indicator
uses provider input/output usage or explicitly labeled estimates.

The conversation sidebar groups stored conversations by the folder they work in.
A group is titled with the folder's own name, and carries its path below when two
folders share that name. The pen control on a group heading chooses that folder as
the default for new conversations, and chooses it again to clear the default; the
folder is remembered per window and is written to a conversation only when its
first message is sent.

Edit the installed source folder and reload from Plugin studio, or use
`npm run plugins:watch` to sync repository edits. Reloading the backend adapter
cancels its runs; ordinary UI navigation does not. See the repository's
[architecture](../../ARCHITECTURE.md) for lifecycle and persistence contracts.
