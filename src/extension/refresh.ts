import * as vscode from 'vscode';
import type { Repository } from './gitApi';

const DEBOUNCE_MS = 100;

/**
 * Coalesces refresh requests: bursts collapse into one run, a request during a run queues
 * exactly one more, and requests while the view is hidden wait until it is shown.
 */
export class Refresher implements vscode.Disposable {
	private timer: NodeJS.Timeout | undefined;
	private running = false;
	private queued = false;
	private missed = false;

	constructor(private readonly refresh: () => Promise<void>, private readonly isVisible: () => boolean) {}

	request(): void {
		if (!this.isVisible()) {
			this.missed = true;
			return;
		}
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.run(), DEBOUNCE_MS);
	}

	/** Call when the view becomes visible. */
	shown(): void {
		if (this.missed) {
			this.missed = false;
			this.request();
		}
	}

	private async run(): Promise<void> {
		if (this.running) {
			this.queued = true;
			return;
		}
		this.running = true;
		try {
			await this.refresh();
		} finally {
			this.running = false;
			if (this.queued) {
				this.queued = false;
				void this.run();
			}
		}
	}

	dispose(): void {
		clearTimeout(this.timer);
	}
}

/**
 * Everything that should redraw the graph for one repository:
 * a `git` command finishing in a terminal (primary), the Git extension's state change,
 * and changes to HEAD and refs on disk (backups for other tools and shells without integration).
 */
export function watchRepository(repo: Repository, dirs: { gitDir: string; commonDir: string }, onChange: () => void): vscode.Disposable {
	const watchers = [
		vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dirs.gitDir), 'HEAD')),
		vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dirs.commonDir), '{refs/**,packed-refs}')),
	];
	return vscode.Disposable.from(
		vscode.window.onDidEndTerminalShellExecution(event => {
			if (/^\s*git(\s|$)/.test(event.execution.commandLine.value)) {
				onChange();
			}
		}),
		repo.state.onDidChange(onChange),
		...watchers,
		...watchers.flatMap(w => [w.onDidCreate(onChange), w.onDidChange(onChange), w.onDidDelete(onChange)]),
	);
}
