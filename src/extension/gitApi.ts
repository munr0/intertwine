import * as vscode from 'vscode';

// The subset of the built-in Git extension's API (extensions/git/src/api/git.d.ts in the
// VS Code repository) that Intertwine uses.

interface GitExtension {
	getAPI(version: 1): API;
}

export type APIState = 'uninitialized' | 'initialized';

export interface API {
	readonly state: APIState;
	readonly onDidChangeState: vscode.Event<APIState>;
	readonly git: { readonly path: string };
	readonly repositories: Repository[];
	readonly onDidOpenRepository: vscode.Event<Repository>;
	readonly onDidCloseRepository: vscode.Event<Repository>;
	toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

export interface Repository {
	readonly rootUri: vscode.Uri;
	readonly state: { readonly onDidChange: vscode.Event<void> };
	checkout(treeish: string): Promise<void>;
}

/** Undefined when the Git extension is missing or disabled (`git.enabled: false`). */
export async function getGitApi(): Promise<API | undefined> {
	const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
	if (!extension) {
		return undefined;
	}
	try {
		const exports = extension.isActive ? extension.exports : await extension.activate();
		return exports.getAPI(1);
	} catch {
		return undefined;
	}
}
