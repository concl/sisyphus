# Actions

Actions is a general workflow editor with a grid of titled, colored shortcuts.
Three independent parts compose it:

| Part             | Responsibility                                                         |
| ---------------- | ---------------------------------------------------------------------- |
| Backend services | Expose named actions, settings, validation, and result fields.         |
| Workflows        | Connect actions, resolve values, run dependencies, and report results. |
| Cards            | Provide titles, colors, saved inputs, and a convenient manual trigger. |

The engine runs without cards or persistent storage. The editor discovers actions
from backend extensions; it has no fixed action catalog or application-specific
settings. New services can supply actions without changes to the workflow engine
or editor. Existing saved launchers are imported once, preserving their source.

The editor opens in **Steps**, an ordered overview that names each step's actual
dependencies. **Graph** exposes branches and joins. **Add step** opens a searchable
action library with service categories and a reference preview. Every action uses
the same reference structure: purpose, inputs and defaults, outputs, state changes,
service calls, and examples. The inspector's **Reference** tab uses that same data.

**Save** preserves drafts, including empty workflows, disconnected steps, unavailable
providers, and unfinished JSON or number edits. **Save & run** saves first, then checks
readiness before executing any step. The fixed footer shows save state and a readiness
list whose entries open the relevant step. Feedback overlays do not move the editor.
Document integrity errors (such as cycles or invalid identifiers) still prevent saving.
Unfinished text is stored separately from parsed values and never silently executed.

Automation programs and cards are individual documents under
`%APPDATA%/Sisyphus/automations` on Windows (or under `SISYPHUS_USER_DATA`
for a custom installation):

```text
automations/
  programs/<program-id>/program.json
  cards/<card-id>.json
  migration.json
```

Each program defines its graph and typed inputs. Each card references a program
and stores its own title, color, order, and input values. The grid discovers cards
from their files; there is no combined card database. `migration.json` is a small
version marker that prevents deleted cards from being imported again. Existing
`storage/automations.json` is migrated once and retained as a backup, then stops
being used. Invalid files produce an error naming the file and are never silently
replaced with an empty store. Writes replace individual documents atomically.

A Run step may reference a script anywhere on disk; choosing a script does not
copy it into app data. Programs can also keep scripts or assets beside
`program.json`, using absolute paths in Run settings.

Workflows expose **inputs**: text, numbers, on/off values, lists, and structured
JSON data. In a step, **Show on card** exposes a setting while keeping it editable
in place. Card settings also allow independently defined inputs. Exposed settings
retain their choice lists, number limits, and file/folder controls.
Every action setting can use a literal value, a workflow input, or an earlier
step's result. Expand **Use another value** in the inspector to choose one. Choosing a
result automatically adds its execution dependency. A property path such as
`items.0.url` selects part of structured data. Values retain their types; there
is no implicit code execution or string evaluation.

For example, connect **Run → Read JSON → Format text → Open**. A script returns
JSON on stdout, Read JSON turns it into data, Format text creates an address,
and Open uses it. Or pass **Web request → Response data** straight to another
service's setting. Result data is inspectable in the step and run details.

Simple inputs appear on the card and save automatically, including when navigating
away immediately after an edit. Structured inputs show a compact summary; select
it to edit in a dialog. Done applies the value; Cancel or Escape discards the draft.
Providers can supply summary presentations alongside their input editors.
Run saves pending edits before
starting with a snapshot of those values. Invalid edits remain visible and block
the run rather than silently using older settings.
Duplicate creates a new card using the same program, with independent input
values. You can give a copied tab opener a different website list without
rewriting its program. Saving a changed graph creates an independent program
for that card and copies its accompanying files, preserving the other cards.
The editor explains this when a program is shared. Prior programs remain on disk
when cards are deleted or their graphs are changed; they are reusable documents,
not disposable card settings.
The example **Open browser tabs** card connects its Websites input to the
Open websites action. Enter one complete HTTP/HTTPS address per line. Input values
and static settings are validated before a run starts. Settings supplied by
earlier results are validated after resolution, before their consumer executes.

The initial backend extensions expose these services:

| Extension        | Service              | Actions                       |
| ---------------- | -------------------- | ----------------------------- |
| Computer actions | `system-actions.v1`  | Open, Open websites, Wait     |
| Scripts          | `scripts.v1`         | Run program, Run script       |
| Calendar         | `planner.v1`         | Create event                  |
| Automation       | `automations.v1`     | Run card                      |
| Web actions      | `network-actions.v1` | Web request                   |
| Data actions     | `data-actions.v1`    | Value, Read JSON, Format text |

Each can be enabled, disabled, and reloaded independently. Their action catalog
updates in an open editor. Saved steps retain unavailable actions and explain
which extension needs to be enabled. Backend callers can use the services
directly or call `actions.v1.invoke(actionId, input, context)`.

Open accepts absolute file/folder/workspace
paths and HTTP/HTTPS addresses, with a system-default, code-editor, or custom
application. Run starts an executable with literal arguments (one per line), an
optional working folder, input, and a timeout. Run script has separate interpreter
and script fields. Script execution belongs to `scripts.v1`, independently of
automation or its UI. Commands are not passed through a shell;
choose a shell executable explicitly when needed. Windows `.cmd` files likewise
need an explicit interpreter. Run normally waits for exit and captures output.
The "Continue once the program starts" option detaches a program, which is useful
for servers and apps; a detached program stays open after Stop.

Wait pauses for a duration or polls an HTTP/HTTPS service until it returns a
successful status. Use it between launching a server and opening its page.

In Steps, adding an action inserts it after the selected step and before its successors.
In Graph, adding an action creates another outgoing connection from the selection,
so it can form a parallel branch. Removing a step reconnects its predecessors and
successors; references to removed outputs remain visible and must be repaired before
running. Named card inputs remain available until explicitly removed in Card settings.

In Graph, drag steps to arrange them. Use the zoom controls or Fit to see the whole flow.
Drag an output dot to an input dot, or click the two
dots in order, to connect them. Start has only an output. Multiple outgoing
connections run branches concurrently; multiple incoming connections wait for
every predecessor to succeed. A failed step skips its dependent steps while
independent branches finish. Runnable graphs must be connected to Start and cannot loop.
Select a wire to remove it, or manage connections in the step inspector.

Cards can be colored, duplicated, filtered, deleted, and dragged by their grip
to reorder. Run details show each step's status, errors, and the latest 32,000
characters of output. Another run of the same card is blocked until it finishes.
Stop aborts waits, attempts to terminate attached programs (including their
children on Windows), and stops pending steps. Already opened apps and detached
programs remain running. Programs and cards persist in their individual files; run details
stay in memory, survive panel navigation, and reset when the backend reloads.

The Actions catalog plugin exposes `actions.v1` for service/action registration.
The workflow plugin exposes `workflows.v1` for execution and `automations.v1` for card storage and compatibility
with existing callers. `workflows.v1.run(program, inputs)` runs an in-memory
graph; `runProgram(id, inputs)` runs a saved program without a card. Both return
initial run state immediately; progress is available through the automation run
events and snapshot. `cancel(id)` requests cancellation.
`automations.v1.runCard(id, inputs, { signal })` and `workflows.v1.runCard`
wait for a successful completed run and return its step results. They reject
failed or cancelled runs. Run card is also an action that graphs can compose.
An already running card cannot be started again, including through recursion.

An extension registers a service through a disposable Cordis effect:

```js
module.exports = () => ({
  id: 'example.actions',
  inject: ['actions.v1', 'example.service.v1'],
  apply(ctx) {
    const service = ctx.get('example.service.v1')
    ctx.effect(() =>
      ctx.get('actions.v1').registerService('example', {
        name: 'Example',
        actions: {
          lookup: {
            name: 'Look up an item',
            description: 'Find an item by its name.',
            defaults: { name: '' },
            fields: [{ key: 'name', label: 'Name', kind: 'text' }],
            outputs: [{ key: 'item', label: 'Item', kind: 'json' }],
            validate(input) {
              if (!input.name) throw new Error('Enter a name')
            },
            execute: async (input, context) => ({
              item: await service.lookup(input.name, { signal: context.signal }),
            }),
          },
        },
      }),
    )
  },
})
```

The action id is `example.lookup`. Descriptors use generic form widgets: text,
number, boolean, select, list (`lines`), JSON, and optional file/folder pickers.
`outputs` uses the same value kinds. JSON covers nested objects and arrays;
providers validate their domain-specific shape. `execute` receives
`{ signal, log, flow, node }` and returns JSON-compatible data (up to 1 MB).
Functions and validators stay in the backend; only descriptors reach the editor.

Step settings remain literal JSON in `config`. `bindings` supplies values:

```json
{
  "name": { "input": "person", "path": ["name"] },
  "item": { "step": "lookup-step", "path": ["item"] }
}
```

The existing string input-reference form remains supported. References to step
results must point to an ancestor in the graph. A consumer receives its values
only after all its dependencies succeed. Disposing an action registration removes
it from the catalog and aborts its active calls. Saved cards keep unavailable
steps and disable Run until their providers return. Independent branches can
finish; downstream steps skip a cancelled dependency. Providers should observe
the supplied signal; cancellation cannot undo completed state changes.
The current engine supports dependencies and data passing. Conditions,
loops, and scheduled triggers remain future execution features.

## Agent tools

The chat assistant manages cards through the same `automations.v1` service, so a
workflow can be created or edited from a conversation instead of by editing its
files. The read tools have `read` access; the rest are `write`.

| Tool                | Purpose                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `list_actions`      | Saved cards and their steps.                                                                                |
| `list_action_types` | The actions usable as steps, with settings, defaults, outputs, and reference notes.                         |
| `get_action`        | One card, including step ids, settings, inputs, and connections.                                            |
| `create_action`     | A card from a title and an ordered list of steps.                                                           |
| `update_action`     | Edit a card's metadata, inputs, or steps; `inputValues` changes a saved value without rebuilding the graph. |
| `delete_action`     | Remove a card by id.                                                                                        |
| `run_action`        | Start a card by id.                                                                                         |

`create_action` and `update_action` build node ids, positions, and a single ordered
chain from the step list, and merge each action's defaults into its settings, so
nobody writes the card's JSON files by hand. Both answer with the saved card plus
any readiness `issues`, so the model can tell whether the new action can run and
correct what it cannot. Passing `steps` replaces the graph and gives the card an
independent program, exactly as a graph edit in the editor does. Read a card with
`get_action` before editing it; a value-only change keeps its existing program.

## Package layout

This package owns the editor, cards, styles, action catalog, workflow engine, and
local/network/data adapters. The catalog and editor are separate frontend entries
in one manifest; each keeps its own dependencies and toggle. The plugin ID
`feature.contexts` and panel ID `contexts` remain stable for remembered toggles
and saved dock layouts. Saved programs and cards keep their app-data locations.

[Service contracts](SERVICES.md) describe the injected catalog and presentations.
Planner owns Calendar's optional adapter. The [integrations package](../integrations/README.md)
owns application integrations and saved integration presets. No feature imports
another feature's source.
