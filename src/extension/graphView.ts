import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import type { HostMessage, WebviewMessage } from '../protocol';

/** The graph webview in the bottom panel. Holds the last graph so a reloaded webview can redraw at once. */
export class GraphView implements vscode.WebviewViewProvider, vscode.Disposable {
	static readonly id = 'intertwine.graph';

	private view: vscode.WebviewView | undefined;
	private content: HostMessage | undefined;
	private stale: HostMessage | undefined;
	private readonly messageEmitter = new vscode.EventEmitter<WebviewMessage>();
	private readonly visibilityEmitter = new vscode.EventEmitter<boolean>();
	readonly onDidReceiveMessage = this.messageEmitter.event;
	readonly onDidChangeVisibility = this.visibilityEmitter.event;

	constructor(private readonly extensionUri: vscode.Uri) {}

	get visible(): boolean {
		return this.view?.visible ?? false;
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
		view.webview.options = { enableScripts: true, localResourceRoots: [dist] };
		view.webview.html = html(view.webview, dist);
		view.webview.onDidReceiveMessage((message: WebviewMessage) => {
			if (message.type === 'ready') {
				for (const pending of [this.content, this.stale]) {
					if (pending) {
						void view.webview.postMessage(pending);
					}
				}
			} else {
				this.messageEmitter.fire(message);
			}
		});
		view.onDidChangeVisibility(() => this.visibilityEmitter.fire(view.visible));
		view.onDidDispose(() => {
			this.view = undefined;
			this.visibilityEmitter.fire(false);
		});
		this.visibilityEmitter.fire(view.visible);
	}

	show(message: HostMessage): void {
		if (message.type === 'stale') {
			this.stale = message;
		} else {
			this.content = message;
		}
		void this.view?.webview.postMessage(message);
	}

	dispose(): void {
		this.messageEmitter.dispose();
		this.visibilityEmitter.dispose();
	}
}

function html(webview: vscode.Webview, dist: vscode.Uri): string {
	const nonce = randomBytes(16).toString('base64');
	const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
	const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview-style.css'));
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${style}">
</head>
<body>
	<div id="toolbar" hidden>
		<select id="branch" aria-label="Branch"></select>
		<span id="trunk" class="muted"></span>
		<span id="status"></span>
	</div>
	<div id="notice" hidden></div>
	<div id="scroller" hidden>
		<div id="canvas">
			<div id="rows"></div>
			<svg id="graph" aria-hidden="true"></svg>
		</div>
	</div>
	<div id="empty">Loading…</div>
	<div id="tooltip" role="tooltip" hidden></div>
	<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
