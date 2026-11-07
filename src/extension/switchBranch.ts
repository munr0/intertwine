import * as vscode from 'vscode';
import type { Git } from '../core/git';
import type { Repository } from './gitApi';

const STASH_AND_SWITCH = 'Stash & Switch';

/**
 * Checks out a branch through the Git extension, so the Source Control view and status bar
 * stay in sync. When uncommitted changes block it, offers to stash them first.
 */
export async function switchBranch(repo: Repository, git: Git, branch: string): Promise<void> {
	try {
		await repo.checkout(branch);
		return;
	} catch (error) {
		if (!blockedByChanges(error)) {
			void vscode.window.showErrorMessage(`Couldn't switch to ${branch}: ${describe(error)}`);
			return;
		}
	}
	const choice = await vscode.window.showWarningMessage(
		`Your uncommitted changes would be overwritten by switching to ${branch}.`,
		{ modal: true, detail: 'Stash them (including untracked files) and switch? Get them back later with "git stash pop".' },
		STASH_AND_SWITCH,
	);
	if (choice !== STASH_AND_SWITCH) {
		return;
	}
	try {
		await git.run(['stash', 'push', '--include-untracked', '--message', `intertwine: before switching to ${branch}`]);
		await repo.checkout(branch);
		void vscode.window.showInformationMessage(`Stashed your changes and switched to ${branch}.`);
	} catch (error) {
		void vscode.window.showErrorMessage(`Couldn't stash and switch to ${branch}: ${describe(error)}`);
	}
}

function blockedByChanges(error: unknown): boolean {
	const { gitErrorCode, stderr } = (error ?? {}) as { gitErrorCode?: string; stderr?: string };
	return gitErrorCode === 'DirtyWorkTree'
		|| /would be overwritten by checkout|commit your changes or stash them/i.test(stderr ?? describe(error));
}

function describe(error: unknown): string {
	const { stderr } = (error ?? {}) as { stderr?: string };
	const text = stderr?.trim() || (error instanceof Error ? error.message : String(error));
	return text.split('\n').find(line => line.trim())?.replace(/^(error|fatal): /, '') ?? text;
}
