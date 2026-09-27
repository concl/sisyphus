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

Providers live in `chat.providers.json` in the app data folder. Settings > Chat
shows the full path and an editable JSON document; Settings > Local data can
reveal the file. See [providers.example.json](./providers.example.json) for the
format. Each provider has a unique `id`, a `baseURL`, an optional `apiKey`, and
a `models` array of exact model names. URLs use HTTPS (or HTTP on localhost).
OpenAI's endpoint uses Responses; other endpoints must support the
OpenAI-compatible Chat Completions API.

Save providers, then use Chat's model picker, grouped by provider. The selection
is saved for this device and applies to subsequent replies in all conversations;
running replies keep the model they started with. Use **Reload from file** in
Settings > Chat after editing the file externally. Invalid JSON is reported without overwriting the
file; removing the selected model requires choosing another model before sending.

Keys entered in the JSON are stored as plain text in that file. The existing
single-provider configuration is imported as `default`; its key stays in OS
encrypted storage and is used only for that provider's original endpoint when
`apiKey` is omitted. An explicit empty `apiKey` disables that inherited key.
Ordinary configuration responses and change notifications never contain keys.

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
