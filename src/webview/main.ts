import { select } from 'd3-selection';
import type { GraphCommit, GraphData, HostMessage, RefLabel, SyncState, WebviewMessage } from '../protocol';

interface State {
	scrollTop: number;
}

declare function acquireVsCodeApi(): {
	postMessage(message: WebviewMessage): void;
	getState(): State | undefined;
	setState(state: State): void;
};

const vscode = acquireVsCodeApi();

const ROW = 24;
const LANE = 14;
const PAD = 10;
const RADIUS = 4;
const LANE_COLORS = ['c0', 'c3', 'c1', 'c4', 'c2'];

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const toolbar = byId('toolbar');
const branchSelect = byId<HTMLSelectElement>('branch');
const trunkLabel = byId('trunk');
const statusLabel = byId('status');
const notice = byId('notice');
const scroller = byId('scroller');
const canvas = byId('canvas');
const rows = byId('rows');
const svg = select(document.getElementById('graph') as unknown as SVGSVGElement);
const edgeLayer = svg.append('g').attr('class', 'edges');
const nodeLayer = svg.append('g').attr('class', 'nodes');
const tooltip = byId('tooltip');
const empty = byId('empty');

let restoreScroll = vscode.getState()?.scrollTop;

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
	const message = event.data;
	switch (message.type) {
		case 'graph':
			render(message.data);
			break;
		case 'empty':
			showEmpty(message.message);
			break;
		case 'stale':
			statusLabel.textContent = message.message ? 'Fetch failed' : '';
			statusLabel.title = message.message ? `Remote branches may be out of date.\n${message.message}` : '';
			break;
	}
});

branchSelect.addEventListener('change', () => {
	branchSelect.disabled = true;
	vscode.postMessage({ type: 'checkout', branch: branchSelect.value });
});

scroller.addEventListener('scroll', () => vscode.setState({ scrollTop: scroller.scrollTop }));

vscode.postMessage({ type: 'ready' });

function showEmpty(message: string) {
	toolbar.hidden = true;
	notice.hidden = true;
	scroller.hidden = true;
	empty.hidden = false;
	empty.textContent = message;
}

function render(data: GraphData) {
	toolbar.hidden = false;
	scroller.hidden = false;
	empty.hidden = true;
	notice.hidden = !data.notice;
	notice.textContent = data.notice ?? '';
	trunkLabel.textContent = data.trunk ? `trunk: ${data.trunk}` : '';
	renderSwitcher(data);
	renderGraph(data);
	if (restoreScroll !== undefined) {
		scroller.scrollTop = restoreScroll;
		restoreScroll = undefined;
	}
}

function renderSwitcher(data: GraphData) {
	const options = data.branches.map(b => ({ value: b.name, label: b.name, disabled: false }));
	if (!data.head.branch) {
		options.unshift({ value: '', label: `detached @ ${data.head.hash.slice(0, 7)}`, disabled: true });
	}
	select(branchSelect)
		.selectAll<HTMLOptionElement, (typeof options)[number]>('option')
		.data(options, d => d.value)
		.join('option')
		.attr('value', d => d.value)
		.property('disabled', d => d.disabled)
		.text(d => d.label);
	branchSelect.value = data.head.branch ?? '';
	branchSelect.disabled = data.operation !== null;
	branchSelect.title = data.operation
		? `Finish or abort the ${data.operation} to switch branches`
		: 'Switch branch';
}

interface Edge {
	key: string;
	path: string;
	lane: number;
	sync: SyncState;
	stub: boolean;
}

function renderGraph(data: GraphData) {
	const byHash = new Map(data.commits.map(c => [c.hash, c]));
	const trunkLane = data.commits.find(c => c.refs.some(r => r.trunk))?.lane;
	const headLane = byHash.get(data.head.hash)?.lane;
	// Other lanes cycle through the theme's graph colours, most distinct first.
	const pinnedLanes = new Set([trunkLane, headLane].filter(lane => lane !== undefined)).size;
	const color = (lane: number) =>
		lane === trunkLane ? 'trunk' : lane === headLane ? 'head' : LANE_COLORS[(lane - pinnedLanes) % LANE_COLORS.length];
	const x = (lane: number) => PAD + lane * LANE + LANE / 2;
	const y = (row: number) => row * ROW + ROW / 2;

	const edges: Edge[] = [];
	for (const child of data.commits) {
		const x1 = x(child.lane);
		const y1 = y(child.row);
		child.parents.forEach((hash, i) => {
			const parent = byHash.get(hash);
			if (!parent) {
				// More history below that isn't shown.
				if (i === 0) {
					edges.push({ key: `${child.hash}~`, path: `M${x1},${y1}v${ROW * 0.7}`, lane: child.lane, sync: child.sync, stub: true });
				}
				return;
			}
			const x2 = x(parent.lane);
			const y2 = y(parent.row);
			let path: string;
			let lane: number;
			if (x1 === x2) {
				path = `M${x1},${y1}V${y2}`;
				lane = child.lane;
			} else if (i === 0) {
				// Branched off: run down the child's lane, then curve into the parent.
				const bend = Math.max(y1, y2 - ROW);
				path = `M${x1},${y1}V${bend}C${x1},${bend + (y2 - bend) / 2} ${x2},${bend + (y2 - bend) / 2} ${x2},${y2}`;
				lane = child.lane;
			} else {
				// Merged in: curve over to the parent's lane, then run down it.
				const bend = Math.min(y2, y1 + ROW);
				path = `M${x1},${y1}C${x1},${y1 + (bend - y1) / 2} ${x2},${y1 + (bend - y1) / 2} ${x2},${bend}V${y2}`;
				lane = parent.lane;
			}
			edges.push({ key: `${child.hash}-${hash}`, path, lane, sync: child.sync, stub: false });
		});
	}

	const graphWidth = PAD * 2 + Math.max(1, data.lanes) * LANE;
	canvas.style.height = `${data.commits.length * ROW}px`;
	canvas.style.setProperty('--graph-width', `${graphWidth}px`);
	svg.attr('width', graphWidth).attr('height', data.commits.length * ROW);

	edgeLayer.selectAll<SVGPathElement, Edge>('path')
		.data(edges, d => d.key)
		.join('path')
		.attr('class', d => `edge lane-${color(d.lane)} ${d.sync}${d.stub ? ' stub' : ''}`)
		.attr('d', d => d.path);

	nodeLayer.selectAll<SVGGElement, GraphCommit>('g')
		.data(data.commits, d => d.hash)
		.join(enter => {
			const g = enter.append('g');
			g.append('circle').attr('class', 'ring').attr('r', RADIUS + 3);
			g.append('circle').attr('class', 'dot').attr('r', RADIUS);
			return g;
		})
		.attr('class', d => `node lane-${color(d.lane)} ${d.sync}${d.hash === data.head.hash ? ' head' : ''}`)
		.attr('transform', d => `translate(${x(d.lane)},${y(d.row)})`);

	select(rows).selectAll<HTMLDivElement, GraphCommit>('div.row')
		.data(data.commits, d => d.hash)
		.join(enter => {
			const row = enter.append('div').attr('tabindex', 0);
			row.append('span').attr('class', 'refs');
			row.append('span').attr('class', 'subject');
			row.append('span').attr('class', 'meta author');
			row.append('span').attr('class', 'meta date');
			row.on('click', (_, d) => vscode.postMessage({ type: 'openDiff', hash: d.hash }))
				.on('keydown', (event: KeyboardEvent, d) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						vscode.postMessage({ type: 'openDiff', hash: d.hash });
					}
				})
				.on('mouseenter', (event: MouseEvent, d) => showTooltip(event, d))
				.on('mouseleave', hideTooltip);
			return row;
		})
		.attr('class', d => `row ${d.sync}`)
		.style('transform', d => `translateY(${d.row * ROW}px)`)
		.call(row => {
			row.select('.refs')
				.selectAll<HTMLSpanElement, RefLabel & { lane: number }>('span')
				.data(d => d.refs.map(r => ({ ...r, lane: d.lane })), r => r.name)
				.join('span')
				.attr('class', r => `ref lane-${color(r.lane)}${r.head ? ' head' : ''}${r.remote ? ' remote' : ''}`)
				.text(r => r.name);
			row.select('.subject').text(d => d.subject);
			row.select('.author').text(d => d.author);
			row.select('.date').text(d => relativeTime(d.authorTime));
		});
}

const SYNC_TEXT: Record<SyncState, string> = {
	synced: 'On a local branch and a remote',
	local: 'Local only: not pushed',
	remote: 'Remote only: not on any local branch',
};

function showTooltip(event: MouseEvent, commit: GraphCommit) {
	tooltip.replaceChildren();
	const line = (text: string, className: string) => {
		const div = document.createElement('div');
		div.className = className;
		div.textContent = text;
		tooltip.append(div);
	};
	line(`${commit.hash.slice(0, 10)} · ${commit.author} · ${new Date(commit.authorTime * 1000).toLocaleString()}`, 'tip-meta');
	line(SYNC_TEXT[commit.sync], 'tip-meta');
	line(commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject, 'tip-message');
	tooltip.hidden = false;

	const row = (event.currentTarget as HTMLElement).getBoundingClientRect();
	const box = tooltip.getBoundingClientRect();
	const left = Math.min(Math.max(4, event.clientX - 12), window.innerWidth - box.width - 4);
	const below = row.bottom + 2;
	const top = below + box.height > window.innerHeight ? row.top - box.height - 2 : below;
	tooltip.style.left = `${Math.max(4, left)}px`;
	tooltip.style.top = `${Math.max(4, top)}px`;
}

function hideTooltip() {
	tooltip.hidden = true;
}

function relativeTime(seconds: number): string {
	const minutes = Math.round((Date.now() / 1000 - seconds) / 60);
	if (minutes < 1) {
		return 'now';
	}
	if (minutes < 60) {
		return `${minutes}m`;
	}
	const hours = Math.round(minutes / 60);
	if (hours < 24) {
		return `${hours}h`;
	}
	const days = Math.round(hours / 24);
	if (days < 30) {
		return `${days}d`;
	}
	const months = Math.round(days / 30);
	return months < 12 ? `${months}mo` : `${Math.round(days / 365)}y`;
}
