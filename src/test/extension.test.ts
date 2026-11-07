import * as assert from 'assert';
import * as vscode from 'vscode';

// A smoke test only. Write throwaway tests for specific behaviour and delete them once it works.
suite('Intertwine', () => {
	test('activates and registers its command and view', async () => {
		const extension = vscode.extensions.all.find(e => e.id.endsWith('.intertwine'));
		assert.ok(extension, 'extension not found');
		await extension.activate();
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('intertwine.toggleFocusMode'));
		assert.ok(commands.includes('intertwine.graph.focus'));
	});
});
