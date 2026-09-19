# Sisyphus

A composable desktop workspace powered by [Cordis](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md). Cordis is the only plugin kernel. Home, Terminal, Python Host, Planner, the docked UI, storage, and native capabilities are plugins.

## Run

Requires Node.js 22+ and Python 3.10+.

```sh
python scripts/setup.py
python scripts/build_and_run_desktop.py
```

Or run `npm run build` then `npm start`. The frontend can run alone with `npm -w frontend run dev`; terminal and Python operations need Electron.

Drag tabs to stack or split panels and drag the dividers to resize. **Layouts → Save** stores a named layout; the current layout also autosaves in JSON. Use **Add block** to open another block. **Plugins** unloads/reloads features and desktop providers. The Planner keeps local to-dos and dated events and can sync a JSON document through a user-chosen cloud-mirrored folder with **Choose folder** and **Sync now**.

**Chat** answers in Markdown and can work in a folder. Conversations start with **no folder**; attach one from the block header (or the welcome screen) and only that conversation gets file reads, edits, and one-shot shell commands. The sidebar shows which conversations are bound. Inside a folder, type `@` in the composer to reference a file or folder by name, and every tool call and result is listed under the reply. **Settings → Chat → Tools and access** decides what is allowed: _read_ for reading, _read and change_ for edits and commands, and no folder for none of it. Paths resolve inside the chosen folder only.

## Find a feature

Each visual plugin is in `packages/plugin-<name>/src`, with its own `icon.svg`, component, and styles. Native providers are in `apps/desktop/plugins`, with logic in `apps/desktop/lib`. The desktop and renderer composition lists are `apps/desktop/profile.js` and `apps/frontend/src/profile.ts`. Shared contracts are in `packages/sdk/src/index.ts`; `packages/profile` is a small Cordis composition helper. See [ARCHITECTURE.md](ARCHITECTURE.md) for the complete map and sync contract.

## Verify

```sh
npm test
npm run lint
python scripts/test.py
npm run smoke
python scripts/build.py --package
```

The smoke run exercises the Electron UI, shell, Python server, plugin reloads, and layout persistence. `SISYPHUS_USER_DATA` can point it to an isolated data directory. Python servers are listed in `services/python-host/servers.json`; `SISYPHUS_PYTHON` selects an alternate interpreter.
