# Notes

Notes edits Markdown files in a project folder. **Open folder** selects an existing
folder; **New project** creates a named folder in a chosen location. There is no
automatically created project. Existing notes from the earlier app-data default
remain accessible. The project picker lists recently opened folders.

The layout follows Chat: a resizable file sidebar and a single compact toolbar.
Edit is the default; Split and Read show the Markdown preview. File operations
are under the toolbar's **…** menu. Backlinks are collapsed until opened.
New files start empty. The sidebar supports folders (including empty folders),
full-text search, and daily notes. Selecting a folder chooses where New note starts.
The sidebar overlays the editor in narrow panels and can be hidden.

The selected folder and recent projects are saved in `userData/notes-vault.json`.
Switching projects saves the current note and restores that project's last open note.
Notes remain ordinary
UTF-8 `.md` files. Hidden directories such as `.obsidian` and `.trash` are excluded.
Files larger than 2 MB and symbolic links are excluded with a visible warning for
unreadable Markdown files. This initial version scans the vault every four seconds
for external changes; it is intended for personal vaults rather than huge archives.

Create nested notes with `Projects/Idea`. Wiki links accept `[[Idea]]`,
`[[Projects/Idea]]`, and `[[Idea|label]]`. Unique filenames resolve across folders;
ambiguous filenames need the full vault-relative path. Clicking a missing link
offers to create it. Heading suffixes open the note (without scrolling to the
heading). Renaming/moving does not rewrite links in other notes. The preview
supports standard Markdown and tables; image attachments are shown as labels.
Obsidian plugins, embeds, graph view, and frontmatter-based features are not implemented.

Saves use revisions and atomic replacement. A stale draft never deliberately
overwrites a newer disk revision. Unsaved drafts are also retained in renderer
local storage, including across plugin reloads. A conflict blocks navigation until
the draft is saved using **Save copy** or discarded using **Reload from disk**. Trash
moves a file into `.trash` instead of deleting it permanently.

## Services

The backend provides `notes.v1` independently of the UI. Its async methods are:
`list({query?})`, `read({path})`, `create({path,content})`,
`save({path,content,revision})`, `append({path,content})`,
`rename({path,newPath,revision})`, `trash({path,revision})`, and `daily({date?})`.
Read/create/save return `{path,title,content,revision,modified,tags,links,excerpt}`.
List returns `{folder,projects,folders,notes,warnings}`; note summaries omit content.
Project methods are `setFolder(absolutePath)`, `createProject({parent,name})`, and
`createFolder({path})`. Creating a project fails if its folder already exists.
Operations run in order and filesystem writes survive plugin disposal.

The separate Notes actions adapter injects `notes.v1` and `actions.v1` and registers
`notes.list`, `notes.read`, `notes.create`, `notes.append`, and `notes.daily` in the
Services/action library. Each includes settings, result fields, effect descriptions,
and examples. Workflows can connect a note's `content` or `path` to another step.
The adapter unregisters actions when disabled/reloaded. Cancellation cannot undo a
completed write. All operations use the vault currently selected in Notes.

The optional agent tool adapter exposes `list_notes`, `read_notes`, `create_notes`,
`save_notes`, `append_notes`, and `daily_notes` with the appropriate read/write access.
The renderer provides its own `notes.v1` NotesStore, including subscriptions and
navigation/editor operations; objects do not cross the IPC boundary.

Checks: `node --test bootstrap/backend/test/notes.test.js`,
`npm run typecheck:plugins`, and `node scripts/notes-smoke.cjs`.
