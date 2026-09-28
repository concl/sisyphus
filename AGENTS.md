# Working on Sisyphus

## Make app changes available at runtime

Sisyphus runs editable plugins from its app data directory. This is a defining
feature of the app. An app change is not complete when it exists only in the
repository: push the changed runtime files to the app data directory as part of
the same task, without waiting for a separate request.

For every change to app behavior, UI, styles, assets, or plugin packages:

1. Make the source changes in the repository and run the relevant checks.
2. Run `npm run plugins:sync` from the repository root after the final edits.
   This command rebuilds `build/plugins` and syncs the plugin source packages to
   app data; a separate `build:plugins` step is not needed. Building or testing
   alone does not satisfy this requirement.
3. Confirm the destination is the installation being used. Sync honors
   `SISYPHUS_USER_DATA`; on Windows its default is `%APPDATA%/Sisyphus/plugins`.
   Use `npm run plugins:sync -- --dest <app-data-plugins-folder>` when targeting
   a different installation. Do not substitute an isolated test profile for the
   user's runtime installation.
4. Inspect the sync output and verify the affected files in app data match the
   intended changes. Files reported as `kept` may contain edits made in the app;
   compare and reconcile affected files while preserving unrelated work. Do not
   blindly use `--force` across the installation.
5. Activate the affected plugins through the available runtime reload mechanism
   and verify the changed behavior when possible. A successful copy does not
   prove the new code is mounted: by default changes remain pending until
   **Plugins → Reload** / **Reload all**, or `plugin_reload`. **Reload on
   save** applies changes automatically only when already enabled. If runtime
   reload is unavailable, explicitly report that the files are synced and a
   reload is still needed; do not claim the running app has been updated.

`npm run plugins:watch` and `npm run dev:app` provide continuous plugin syncing
while iterating. Even when a watcher is running, verify that the final changes
reached app data. The plugin watcher watches `plugins/`, not every repository
directory.

Changes to `bootstrap/` or host-provided libraries in `shared/` can require a
host rebuild and restart in addition to plugin syncing. Perform the applicable
build and clearly report any remaining restart requirement. Plugin reload alone
does not update host code. Documentation-only changes have no runtime files to
sync.

Before finishing, state what was checked, whether syncing succeeded, and whether
the change is active or still needs reload/restart. Report build, sync, or reload
failures explicitly rather than silently leaving the runtime on old code.

See `README.md` ("Change the running app"), `ARCHITECTURE.md` ("Developer loop"),
and `scripts/plugin-sync.js` for the runtime workflow.
