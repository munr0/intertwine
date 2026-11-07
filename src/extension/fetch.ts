import * as vscode from 'vscode';
import type { Git } from '../core/git';

/**
 * Runs `git fetch --all --prune` when the graph is first shown and every few minutes while it
 * stays visible, so teammates' new work appears. Off with `intertwine.fetch.enabled: false`.
 */
export class BackgroundFetch implements vscode.Disposable {
	private timer: NodeJS.Timeout | undefined;
	private lastRun = 0;
	private running = false;

	constructor(
		private readonly getGit: () => Git | undefined,
		private readonly isVisible: () => boolean,
		/** Null on success, else the reason the fetch failed. */
		private readonly onDone: (error: string | null) => void,
	) {}

	/** Plans the next fetch. Call when visibility, the repository or the settings change. */
	schedule(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
		const config = vscode.workspace.getConfiguration('intertwine.fetch');
		if (!config.get<boolean>('enabled', true) || !this.isVisible() || !this.getGit()) {
			return;
		}
		const interval = Math.max(1, config.get<number>('intervalMinutes', 5)) * 60_000;
		this.timer = setTimeout(() => void this.fetch(), Math.max(0, this.lastRun + interval - Date.now()));
	}

	/** For a newly opened repository: fetch as soon as the graph is visible. */
	reset(): void {
		this.lastRun = 0;
		this.schedule();
	}

	private async fetch(): Promise<void> {
		const git = this.getGit();
		if (!git || this.running) {
			return;
		}
		this.running = true;
		try {
			await git.run(['fetch', '--all', '--prune', '--quiet'], { timeoutMs: 120_000 });
			this.onDone(null);
		} catch (error) {
			this.onDone((error instanceof Error ? error.message : String(error)).split('\n')[0]);
		} finally {
			this.running = false;
			this.lastRun = Date.now();
			this.schedule();
		}
	}

	dispose(): void {
		clearTimeout(this.timer);
	}
}
