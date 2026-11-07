import * as path from 'path';
import * as vscode from 'vscode';
import type { Git } from '../core/git';
import type { API } from './gitApi';

type Change = [resource: vscode.Uri, original: vscode.Uri | undefined, modified: vscode.Uri | undefined];

/** Opens every file a commit changed in VS Code's multi-file diff editor, against its first parent. */
export async function showCommitDiff(api: API, git: Git, hash: string): Promise<void> {
	const [parents, subject] = (await git.run(['log', '-1', '--format=%P%x1f%s', hash])).trimEnd().split('\x1f');
	const parent = parents.split(' ').filter(Boolean)[0];
	const out = await git.run(parent
		? ['diff-tree', '-r', '-z', '-M', '--name-status', '--no-commit-id', parent, hash]
		: ['diff-tree', '-r', '-z', '-M', '--name-status', '--no-commit-id', '--root', hash]);

	const file = (relative: string) => vscode.Uri.file(path.join(git.cwd, relative));
	const before = (uri: vscode.Uri) => (parent ? api.toGitUri(uri, parent) : undefined);
	const changes: Change[] = [];
	const fields = out.split('\0');
	for (let i = 0; i < fields.length - 1;) {
		const status = fields[i++];
		if (status.startsWith('R') || status.startsWith('C')) {
			const from = file(fields[i++]);
			const to = file(fields[i++]);
			changes.push([to, api.toGitUri(from, parent), api.toGitUri(to, hash)]);
		} else {
			const uri = file(fields[i++]);
			changes.push([
				uri,
				status === 'A' ? undefined : before(uri),
				status === 'D' ? undefined : api.toGitUri(uri, hash),
			]);
		}
	}

	const title = `${hash.slice(0, 7)} ${subject}`;
	if (changes.length === 0) {
		void vscode.window.showInformationMessage(`${title} changes no files.`);
		return;
	}
	await vscode.commands.executeCommand('vscode.changes', title, changes);
}
