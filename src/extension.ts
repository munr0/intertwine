import * as vscode from 'vscode';
import { Controller } from './extension/controller';
import { FocusMode, type SidebarState } from './extension/focusMode';
import { getGitApi } from './extension/gitApi';
import { GraphView } from './extension/graphView';

export async function activate(context: vscode.ExtensionContext) {
	const view = new GraphView(context.extensionUri);
	const focusMode = new FocusMode();
	context.subscriptions.push(
		view,
		focusMode,
		vscode.window.registerWebviewViewProvider(GraphView.id, view),
		vscode.commands.registerCommand('intertwine.toggleFocusMode', (before?: SidebarState) => focusMode.toggle(before)),
	);

	const status = vscode.window.createStatusBarItem('intertwine.focusMode', vscode.StatusBarAlignment.Left, 0);
	status.name = 'Intertwine';
	status.command = 'intertwine.toggleFocusMode';
	const updateStatus = (active: boolean) => {
		status.text = active ? '$(screen-normal) Intertwine' : '$(git-merge) Intertwine';
		status.tooltip = active ? 'Leave Intertwine focus mode' : 'Show the Intertwine graph beside the terminal';
	};
	updateStatus(false);
	context.subscriptions.push(status, focusMode.onDidChange(updateStatus));

	const api = await getGitApi();
	if (!api) {
		view.show({ type: 'empty', message: 'Intertwine needs the built-in Git extension. Check that "git.enabled" is on.' });
		return;
	}
	const controller = new Controller(api, view);
	const showStatus = (hasRepository: boolean) => (hasRepository ? status.show() : status.hide());
	showStatus(controller.hasRepository);
	context.subscriptions.push(controller, controller.onDidChangeRepository(showStatus));
}

export function deactivate() {}
