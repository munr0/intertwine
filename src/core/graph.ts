import * as fs from 'fs';
import * as path from 'path';
import type { BranchOption, GraphCommit, GraphData, Operation, RefLabel } from '../protocol';
import { Git } from './git';
import { layout } from './layout';

export interface GraphOptions {
	/** Trunk ref chosen by the user (`origin/develop`, `main`); empty to detect it. */
	trunk?: string;
	/** Trunk commits shown below the oldest fork point. */
	trunkContext?: number;
}

/** Thrown when there is nothing to draw, with a message for the user. */
export class EmptyGraph extends Error {}

/** First-parent trunk commits read at most; fork points further back than this are cut off. */
const TRUNK_LIMIT = 1000;
/** Commits shown from HEAD when no trunk was found. */
const NO_TRUNK_LIMIT = 50;

interface Ref {
	/** Full name: `refs/heads/feature`, `refs/remotes/origin/feature`. */
	name: string;
	hash: string;
	committerTime: number;
}

/**
 * Builds the graph for the checked-out branch: trunk, HEAD, and every local or remote branch
 * that shares at least one non-trunk commit with HEAD.
 */
export async function buildGraph(git: Git, options: GraphOptions = {}): Promise<GraphData> {
	const [refsOut, headHash, headBranch, gitDir] = await Promise.all([
		git.run(['for-each-ref', '--format=%(refname)%1f%(objectname)%1f%(committerdate:unix)%1f%(symref)', 'refs/heads', 'refs/remotes']),
		git.tryRun(['rev-parse', '--verify', '--quiet', 'HEAD']),
		git.tryRun(['symbolic-ref', '--quiet', '--short', 'HEAD']),
		git.run(['rev-parse', '--absolute-git-dir']),
	]);
	if (!headHash) {
		throw new EmptyGraph('No commits yet.');
	}
	const head = headHash.trim();
	const branch = headBranch?.trim() || null;

	const refs: Ref[] = [];
	const symrefs = new Map<string, string>();
	for (const line of refsOut.split('\n')) {
		const [name, hash, time, symref] = line.split('\x1f');
		if (!name) {
			continue;
		}
		if (symref) {
			symrefs.set(name, symref);
		} else {
			refs.push({ name, hash, committerTime: Number(time) });
		}
	}
	const refByName = new Map(refs.map(r => [r.name, r]));
	const trunk = findTrunk(refByName, symrefs, options.trunk?.trim());

	let shown: Set<string>;
	let tips: string[];
	let notice: string | null = null;
	if (trunk) {
		({ shown, tips } = await relatedCommits(git, refs, trunk, head, options.trunkContext ?? 10));
	} else {
		notice = options.trunk?.trim()
			? `Trunk "${options.trunk.trim()}" not found. Showing ${branch ?? 'HEAD'} only.`
			: `No trunk branch found. Set "intertwine.trunk" to choose one. Showing ${branch ?? 'HEAD'} only.`;
		const own = await git.run(['rev-list', `--max-count=${NO_TRUNK_LIMIT}`, head]);
		shown = new Set(own.split('\n').filter(Boolean));
		tips = [head];
	}

	const [commits, sync] = await Promise.all([readCommits(git, shown), readSync(git)]);

	const labels = new Map<string, RefLabel[]>();
	for (const ref of refs) {
		if (!shown.has(ref.hash)) {
			continue;
		}
		const label: RefLabel = {
			name: shortName(ref.name),
			remote: ref.name.startsWith('refs/remotes/'),
			head: branch !== null && ref.name === `refs/heads/${branch}`,
			trunk: ref.name === trunk?.name,
		};
		labels.set(ref.hash, [...(labels.get(ref.hash) ?? []), label]);
	}
	const rank = (l: RefLabel) => (l.head ? 0 : l.trunk ? 1 : l.remote ? 3 : 2);
	for (const list of labels.values()) {
		list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
	}

	// Trunk first, then HEAD, then related branches newest first.
	const pinned = trunk ? [trunk.hash, head] : [head];
	const { row, lane, lanes } = layout(commits, [...pinned, ...tips], pinned.length);

	const graphCommits: GraphCommit[] = commits.map(c => ({
		hash: c.hash,
		parents: c.parents,
		author: c.author,
		authorTime: c.authorTime,
		subject: c.subject,
		body: c.body,
		sync: sync.localOnly.has(c.hash) ? 'local' : sync.remoteOnly.has(c.hash) ? 'remote' : 'synced',
		refs: labels.get(c.hash) ?? [],
		row: row.get(c.hash)!,
		lane: lane.get(c.hash)!,
	}));
	graphCommits.sort((a, b) => a.row - b.row);

	const branches: BranchOption[] = refs
		.filter(r => r.name.startsWith('refs/heads/'))
		.map(r => ({ name: shortName(r.name), committerTime: r.committerTime }))
		.sort((a, b) => b.committerTime - a.committerTime || a.name.localeCompare(b.name));

	return {
		trunk: trunk ? shortName(trunk.name) : null,
		head: { hash: head, branch },
		operation: readOperation(gitDir.trim()),
		branches,
		commits: graphCommits,
		lanes,
		notice,
	};
}

/** The user's choice, else `origin/HEAD`, else main, else master. */
function findTrunk(refs: Map<string, Ref>, symrefs: Map<string, string>, override?: string): Ref | null {
	if (override) {
		return refs.get(override) ?? refs.get(`refs/heads/${override}`) ?? refs.get(`refs/remotes/${override}`) ?? null;
	}
	const originHead = symrefs.get('refs/remotes/origin/HEAD');
	const candidates = [
		originHead,
		'refs/remotes/origin/main', 'refs/heads/main',
		'refs/remotes/origin/master', 'refs/heads/master',
	];
	for (const name of candidates) {
		const ref = name ? refs.get(name) : undefined;
		if (ref) {
			return ref;
		}
	}
	return null;
}

/**
 * A ref is related when its merge-base with HEAD is not an ancestor of trunk, which is the same
 * as: the ref reaches a commit that HEAD reaches and trunk doesn't. One rev-list over every ref
 * minus trunk answers that for all refs at once.
 */
async function relatedCommits(git: Git, refs: Ref[], trunk: Ref, head: string, trunkContext: number) {
	const candidates = [...new Set([head, ...refs.filter(r => r !== trunk).map(r => r.hash)])];
	const out = await git.run(['rev-list', '--topo-order', '--parents', '--stdin'], {
		input: [...candidates, `^${trunk.hash}`].join('\n') + '\n',
	});
	// Children before parents, so walking it backwards visits parents first.
	const parentsOf = new Map<string, string[]>();
	for (const line of out.split('\n')) {
		const [hash, ...parents] = line.split(' ');
		if (hash) {
			parentsOf.set(hash, parents);
		}
	}

	const ownCommits = reachable([head], parentsOf);
	const reachesOwn = new Set<string>();
	for (const hash of [...parentsOf.keys()].reverse()) {
		if (ownCommits.has(hash) || parentsOf.get(hash)!.some(p => reachesOwn.has(p))) {
			reachesOwn.add(hash);
		}
	}

	const relatedRefs = refs
		.filter(r => r !== trunk && reachesOwn.has(r.hash))
		.sort((a, b) => b.committerTime - a.committerTime);
	const tips = [...new Set(relatedRefs.map(r => r.hash))];
	const shown = reachable([head, ...tips], parentsOf);

	// Where the shown work leaves trunk. With no work of its own, HEAD sits on trunk's history.
	const forkPoints = new Set<string>();
	for (const hash of shown) {
		for (const parent of parentsOf.get(hash)!) {
			if (!parentsOf.has(parent)) {
				forkPoints.add(parent);
			}
		}
	}
	if (!parentsOf.has(head)) {
		forkPoints.add(head);
	}

	const trunkLine = (await git.run(['rev-list', '--first-parent', `--max-count=${TRUNK_LIMIT}`, trunk.hash]))
		.split('\n').filter(Boolean);
	const deepest = trunkLine.reduce((max, hash, i) => (forkPoints.has(hash) ? i : max), -1);
	const keep = Math.min(trunkLine.length, (deepest < 0 ? 0 : deepest + 1) + Math.max(0, trunkContext));
	for (const hash of trunkLine.slice(0, Math.max(1, keep))) {
		shown.add(hash);
	}
	// Fork points off trunk's first-parent line (inside a merged branch) are drawn on their own.
	for (const hash of forkPoints) {
		shown.add(hash);
	}
	return { shown, tips };
}

function reachable(starts: string[], parentsOf: Map<string, string[]>): Set<string> {
	const seen = new Set<string>();
	const stack = starts.filter(h => parentsOf.has(h));
	while (stack.length > 0) {
		const hash = stack.pop()!;
		if (seen.has(hash)) {
			continue;
		}
		seen.add(hash);
		for (const parent of parentsOf.get(hash)!) {
			if (parentsOf.has(parent)) {
				stack.push(parent);
			}
		}
	}
	return seen;
}

interface Commit {
	hash: string;
	parents: string[];
	author: string;
	authorTime: number;
	commitTime: number;
	subject: string;
	body: string;
}

async function readCommits(git: Git, hashes: Set<string>): Promise<Commit[]> {
	const out = await git.run(['log', '--no-walk=unsorted', '-z', '--format=%H%x1f%P%x1f%an%x1f%at%x1f%ct%x1f%s%x1f%b', '--stdin'], {
		input: [...hashes].join('\n') + '\n',
	});
	return out.split('\0').filter(Boolean).map(record => {
		const [hash, parents, author, authorTime, commitTime, subject, body] = record.split('\x1f');
		return {
			hash,
			parents: parents ? parents.split(' ') : [],
			author,
			authorTime: Number(authorTime),
			commitTime: Number(commitTime),
			subject,
			body: body.trimEnd(),
		};
	});
}

/** HEAD counts as local, so commits made on a detached HEAD read as unpushed. */
async function readSync(git: Git) {
	const [localOnly, remoteOnly] = await Promise.all([
		git.run(['rev-list', '--branches', 'HEAD', '--not', '--remotes']),
		git.run(['rev-list', '--remotes', '--not', '--branches', 'HEAD']),
	]);
	const toSet = (out: string) => new Set(out.split('\n').filter(Boolean));
	return { localOnly: toSet(localOnly), remoteOnly: toSet(remoteOnly) };
}

function readOperation(gitDir: string): Operation | null {
	const has = (name: string) => fs.existsSync(path.join(gitDir, name));
	if (has('rebase-merge') || has('rebase-apply')) {
		return 'rebase';
	}
	if (has('MERGE_HEAD')) {
		return 'merge';
	}
	if (has('CHERRY_PICK_HEAD')) {
		return 'cherry-pick';
	}
	if (has('REVERT_HEAD')) {
		return 'revert';
	}
	return null;
}

function shortName(refName: string): string {
	return refName.replace(/^refs\/(heads|remotes)\//, '');
}
