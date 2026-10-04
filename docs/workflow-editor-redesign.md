# Workflow editor redesign

## Product contract

Build a workflow by choosing an action, filling in its settings, and adding the
next step. A saved card runs the workflow with one click. The service catalog
remains independent of cards and of the editor. Existing programs, aliases,
custom input controls, and result presentations continue to work.

## Editor

- Default to an ordered step overview. Show actual dependencies explicitly;
  preserve a graph view for branches and joins, without flattening existing graphs.
- Replace the dropdown with a searchable action library: service categories,
  readable action summaries, and a full reference preview before adding a step.
- Use the same reference in the library and the step inspector. The contract is
  purpose, inputs (types, defaults, requirements), outputs, state changes, service
  calls, and examples. Providers own these descriptions alongside their functions.
- Separate settings and reference views. Keep card metadata and run controls
  stable. Put transient feedback in an overlay and save/readiness in a fixed footer.
- Make graph edits explicit: inserting after a selected step retains downstream
  ordering; removing a step reconnects its predecessors and successors and flags
  references to its deleted results for repair. Branching remains available in the graph.

## Persistence and execution

- Saving checks document integrity, not whether external actions can execute.
  Empty workflows, disconnected drafts, missing providers, and unfinished settings
  can be saved. Run performs readiness checks before any side effects.
- Preserve unfinished JSON/number edits in the document separately from parsed
  values. Never run using an older parsed value while invalid text is visible.
- Return actionable readiness issues with step IDs, and focus the relevant step.
  Resolve and validate dynamic outputs immediately before their consumer runs.
- Use provider defaults consistently for direct calls and workflow calls.
- Retain atomic file writes and independent copies of shared programs.

## Validation and delivery

Regression tests cover unfinished draft round-trips, strict execution, defaults,
data references, insertion/deletion, branching, provider documentation, and input
editing. Run plugin type checking, lint, and the existing backend/frontend suites.
Build and sync the final plugin sources to the running installation, compare the
affected app-data files, reload affected plugins, and inspect the live editor.

Conditions, loops, and scheduling are outside this redesign; the current runner
executes a dependency graph. The UI must describe that behavior accurately.
