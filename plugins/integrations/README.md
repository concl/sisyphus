# Application integrations

This backend-only package owns the integration registry, browser and Visual Studio
Code integrations, and saved integration presets (the `app-contexts.v1` service).
It keeps the existing IDs `desktop.app-contexts`, `desktop.integrations`,
`desktop.integration.browser`, and `desktop.integration.vscode`.

The [Actions package](../actions/README.md) owns workflow execution and editing.
Its computer actions use `integrations.v1` through dependency injection.
The shared editor launcher lives in `@sisyphus/native/vscode-launcher`.
