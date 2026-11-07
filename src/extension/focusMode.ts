import * as vscode from 'vscode';
import { GraphView } from './graphView';

/** Which sidebars were open before entering. Keybindings pass this, read from context keys. */
export interface SidebarState {
	sideBar?: boolean;
	auxiliaryBar?: boolean;
}

/**
 * Turns the window into graph + terminal: focus the graph, hide the sidebars, maximize the panel.
 * Toggling again reverses each step. Maximizing only covers the editor area, so editor tabs are
 * never closed or moved.
 */
export class FocusMode implements vscode.Disposable {
	private restore: SidebarState | undefined;
	private readonly emitter = new vscode.EventEmitter<boolean>();
	readonly onDidChange = this.emitter.event;

	get active(): boolean {
		return this.restore !== undefined;
	}

	async toggle(before?: SidebarState): Promise<void> {
		const run = (command: string) => vscode.commands.executeCommand(command);
		if (this.restore === undefined) {
			// Without context (status bar, command palette), assume the usual: primary sidebar open, secondary closed.
			this.restore = { sideBar: before?.sideBar ?? true, auxiliaryBar: before?.auxiliaryBar ?? false };
			await run(`${GraphView.id}.focus`);
			await run('workbench.action.closeSidebar');
			await run('workbench.action.closeAuxiliaryBar');
			await run('workbench.action.toggleMaximizedPanel');
		} else {
			const restore = this.restore;
			this.restore = undefined;
			await run('workbench.action.toggleMaximizedPanel');
			if (restore.sideBar) {
				await run('workbench.action.toggleSidebarVisibility');
			}
			if (restore.auxiliaryBar) {
				await run('workbench.action.toggleAuxiliaryBar');
			}
		}
		await vscode.commands.executeCommand('setContext', 'intertwine.focusMode', this.active);
		this.emitter.fire(this.active);
	}

	dispose(): void {
		this.emitter.dispose();
	}
}
