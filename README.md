# Intertwine

A Visual Studio Code extension that shows a live commit graph of only the branches entangled with yours, shaded by sync state.

Keep it beside a Git terminal: you type the commands, and the graph keeps up. Other graphs show every branch, or only yours. Intertwine answers "whose work is tangled up with mine right now, and what state is it in?"

## Features

- Shows trunk, your branch, and every local or remote branch that shares a non-trunk commit with yours. Everything else is hidden.
- Draws where each commit lives: **solid** is local and pushed, **dashed** is local only, **faint** is remote only.
- Redraws after each `git` command in the terminal, and after Git changes made anywhere else.
- Fetches in the background while the graph is visible, so teammates' new work appears.
- Click a commit to open its changes in the multi-file diff view. Hover for the full message.
- Switch branches from the dropdown. If uncommitted changes are in the way, stash and switch in one step.

## Usage

### Open the graph

Intertwine adds a tab to the bottom panel. Run **Intertwine: Toggle Focus Mode** to focus the graph, hide the sidebars and maximize the panel. Run it again to put everything back. Editor tabs are never closed or moved.

Toggle it with <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>G</kbd> (<kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>G</kbd> on macOS), the **Intertwine** item in the status bar, or the button in the graph's title bar.

### Put the terminal beside the graph

Drag the **Terminal** tab into the graph to show both side by side in one panel. VS Code remembers the layout.

### Choose the trunk

Trunk is `origin/HEAD`, then `main`, then `master`. Set `intertwine.trunk` to use another branch.

## Settings

- `intertwine.trunk` – trunk branch, such as `origin/develop` (default: detect)
- `intertwine.trunkContext` – trunk commits shown below the oldest fork point (default: 10)
- `intertwine.fetch.enabled` – fetch in the background while the graph is visible (default: on)
- `intertwine.fetch.intervalMinutes` – minutes between fetches (default: 5)

## Development

```bash
npm install
```

Press <kbd>F5</kbd> to run the extension in a new window.

```bash
npm test
```

Runs the smoke test in a downloaded VS Code. On Linux without a display, prefix it with `xvfb-run -a`.

```bash
npm run compile-tests && node out/cli.js /path/to/repo
```

Prints the graph for a repository as JSON, without VS Code. Add `--trunk <ref>` or `--context <n>` to override the settings.

Code layout:

- `src/core/` – all Git logic, with no VS Code imports
- `src/extension/` – the view, refresh triggers, background fetch, focus mode and branch switching
- `src/webview/` – the graph, drawn with d3
- `src/protocol.ts` – types shared by all three
