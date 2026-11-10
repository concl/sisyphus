# Agent harness contract

Chat owns conversations, attachments, tool permissions, cancellation, and the
event stream the panel draws. A **harness** owns the agent loop: it builds model
requests from a normalized conversation, calls the tools it is given, and streams
text, reasoning, notices, and context usage back.

The contract is defined in `backend/harness/contract.js`. It is plain data, so a
harness does not import Chat, AI SDK types, or Electron.

## Add or swap a harness

1. Add `backend/harnesses/<name>.js` exporting:

   ```js
   module.exports = {
     id: 'my-harness',          // lowercase, persisted in settings
     name: 'My harness',        // shown in Settings > Chat
     description: '...',        // optional
     async run(request, control) {
       // call request.provider, request.messages, request.tools
       return { transcript: [], finishReason: 'stop' }
     },
   }
   ```

2. Register it in `backend/harness/registry.js`:

   ```js
   return new HarnessRegistry([require('../harnesses/vercel-ai'), require('../harnesses/my-harness')])
   ```

3. Reload the Chat plugin. Settings > Chat > Agent harness lists it. The choice is
   stored in `chat.config` (`provider.v1`) and applies to new replies; a running
   reply keeps the harness it started with.

`npm run plugins:sync` copies the changed files into the running app, then reload
the plugin as usual. The worker is bundled by esbuild, so registry entries are
explicit rather than discovered at runtime.

## Request

```ts
interface HarnessRequest {
  runId: string
  conversationId: string
  folder: string | null
  provider: { id: string; baseURL: string; model: string; apiKey?: string }
  systemPrompt: string
  access: 'none' | 'read' | 'write'
  limits: { maxSteps: number; maxRetries: number }
  compaction: { enabled: boolean; contextTokens: number }
  messages: HarnessMessage[]
  tools: HarnessTool[]
}
```

`messages` is the selected branch, oldest first, ending with the user message being
answered. It is not provider-shaped:

```ts
type HarnessMessage =
  | {
      role: 'user'
      text: string
      images: Array<{ data: Buffer; mediaType: string }>
      files: Array<{ name: string; mime: string; size: number; text?: string }>
    }
  | {
      role: 'assistant'
      text: string
      reasoning?: string
      toolCalls?: Array<{
        id: string
        name: string
        input: unknown
        output?: unknown
        status?: 'running' | 'complete' | 'failed'
      }>
      harness?: {
        id: string
        transcript?: unknown[]
        compactedContext?: unknown[]
      }
    }
```

`files[].text` is present only when the app could read the attachment as text
within its inline limit; otherwise describe the file by name, MIME type, and size.
`harness` is opaque replay data recorded by the harness that produced the message.
Use it only when `harness.id` is your id. When it does not match, build history
from the normalized fields instead. Chat does the same: switching harnesses keeps
the transcript readable, but exact tool-step replay is best-effort.

Tools arrive already filtered by access and wrapped by Chat:

```ts
interface HarnessTool {
  name: string
  description: string
  parameters: object // JSON Schema, no $schema
  access: 'read' | 'write'
  execute(input: unknown, context: { signal: AbortSignal }): Promise<unknown>
}
```

The wrapper rechecks current access, writes the audit entry the panel shows,
applies the per-call budget, and aborts work when the reply is stopped. A harness
must call `execute`; it does not implement permissions itself.

## Control and results

```ts
interface HarnessControl {
  signal: AbortSignal
  emit(event:
    | { type: 'text'; text: string }
    | { type: 'reasoning'; text: string }
    | { type: 'notice'; text: string }
    | { type: 'context'; context: ChatContext }
  ): void
  beginWork(): void // non-model work; suspends the silence watchdog
  endWork(): void
}
```

`emit` is the only way a harness writes to the reply. Chat concatenates text and
reasoning, records their order, and draws notices as the app's own words, never as
model output. A harness must pass `control.signal` to provider requests and stop
promptly when it aborts.

`run` resolves to:

```ts
interface HarnessResult {
  transcript?: unknown[]      // exact replay data, stored per reply
  compactedContext?: unknown[] // context checkpoint, stored per reply
  finishReason?: string
  stepLimitHit?: boolean
}
```

Chat handles the reply's status, empty-reply notice, persistence, and the silence
watchdog. The watchdog is suspended while `beginWork`/`endWork` is active and while
a wrapped tool is running, so a slow tool is never reported as a silent model.

## Shipped harness

`backend/harnesses/vercel-ai.js` is the default. It uses the Vercel AI SDK:
OpenAI Responses on `api.openai.com`, Chat Completions on compatible endpoints,
automatic context compaction, reasoning and image handling, and provider
transcripts for exact replay. Its `id` is `vercel-ai`.

## Testing

`bootstrap/backend/test/harness.test.js` registers a fake harness and exercises
selection, JSON Schema tools, streaming, normalized history replay, an unknown
harness error, and the silence watchdog. A new adapter should add a test that
runs it through `ChatService` similarly, so the contract stays honest.
