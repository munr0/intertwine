import * as vscode from 'vscode';
import { Git } from '../core/git';
import { buildGraph, EmptyGraph } from '../core/graph';
import type { WebviewMessage } from '../protocol';
import { showCommitDiff } from './commitDiff';
import { BackgroundFetch } from './fetch';
import type { API, Repository } from './gitApi';
import type { GraphView } from './graphView';
import { Refresher, watchRepository } from './refresh';
import { switchBranch } from './switchBranch';

/** Follows one repository and keeps the graph view up to date with it. */
export class Controller implements vscode.Disposable {
	private repo: Repository | undefined;
	private git: Git | undefined;
	private watcher: vscode.Disposable | undefined;
	private readonly refresher: Refresher;
	private readonly fetcher: BackgroundFetch;
	private readonly disposables: vscode.Disposable[];
	private readonly repoEmitter = new vscode.EventEmitter<boolean>();
	/** Fires whether a repository is open, when that changes. */
	readonly onDidChangeRepository = this.repoEmitter.event;

	constructor(private readonly api: API, private readonly view: GraphView) {
		this.refresher = new Refresher(() => this.render(), () => view.visible);
		this.fetcher = new BackgroundFetch(() => this.git, () => view.visible, error => {
			view.show({ type: 'stale', message: error });
			this.refresher.request();
		});
		this.disposables = [
			this.refresher,
			this.fetcher,
			this.repoEmitter,
			view.onDidReceiveMessage(message => this.onMessage(message)),
			view.onDidChangeVisibility(visible => {
				if (visible) {
					this.refresher.shown();
				}
				this.fetcher.schedule();
			}),
			api.onDidChangeState(() => this.pickRepository()),
			api.onDidOpenRepository(() => this.pickRepository()),
			api.onDidCloseRepository(() => this.pickRepository()),
			vscode.workspace.onDidChangeConfiguration(event => {
				if (event.affectsConfiguration('intertwine')) {
					this.refresher.request();
					this.fetcher.schedule();
				}
			}),
		];
		this.pickRepository();
	}

	get hasRepository(): boolean {
		return this.repo !== undefined;
	}

	/** The outermost open repository, so a submodule never wins over its parent. */
	private pickRepository(): void {
		const repo = [...this.api.repositories]
			.sort((a, b) => a.rootUri.fsPath.length - b.rootUri.fsPath.length)[0];
		if (repo === this.repo) {
			if (!repo) {
				this.refresher.request();
			}
			return;
		}
		this.watcher?.dispose();
		this.watcher = undefined;
		this.repo = repo;
		this.git = repo ? new Git(repo.rootUri.fsPath, this.api.git.path) : undefined;
		this.repoEmitter.fire(repo !== undefined);
		if (repo && this.git) {
			const git = this.git;
			void git.dirs().then(dirs => {
				if (this.git === git) {
					this.watcher = watchRepository(repo, dirs, () => this.refresher.request());
				}
			}, () => {});
		}
		this.refresher.request();
		this.fetcher.reset();
	}

	private async render(): Promise<void> {
		const git = this.git;
		if (!git) {
			this.view.show({
				type: 'empty',
				message: this.api.state === 'initialized' ? 'No Git repository is open.' : 'Looking for a Git repository…',
			});
			return;
		}
		const config = vscode.workspace.getConfiguration('intertwine');
		try {
			const data = await buildGraph(git, {
				trunk: config.get<string>('trunk'),
				trunkContext: config.get<number>('trunkContext'),
			});
			if (git === this.git) {
				this.view.show({ type: 'graph', data });
			}
		} catch (error) {
			if (git === this.git) {
				this.view.show({
					type: 'empty',
					message: error instanceof EmptyGraph ? error.message : `Couldn't read the repository: ${error instanceof Error ? error.message : error}`,
				});
			}
		}
	}

	private onMessage(message: WebviewMessage): void {
		const { repo, git } = this;
		if (!repo || !git) {
			return;
		}
		switch (message.type) {
			case 'checkout':
				// Redraw even when nothing changed, so the switcher shows the real branch again.
				void switchBranch(repo, git, message.branch).finally(() => this.refresher.request());
				break;
			case 'openDiff':
				showCommitDiff(this.api, git, message.hash).catch(error => {
					void vscode.window.showErrorMessage(`Couldn't open the diff: ${error instanceof Error ? error.message : error}`);
				});
				break;
		}
	}

	dispose(): void {
		this.watcher?.dispose();
		vscode.Disposable.from(...this.disposables).dispose();
	}
}
