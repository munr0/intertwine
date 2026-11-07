// Types shared by the core, the extension host and the webview. Types only: this file
// is imported by browser code, so it must not import anything.

/** Where a commit lives: on a local branch and a remote ref, local only, or remote only. */
export type SyncState = 'synced' | 'local' | 'remote';

/** In-progress operation that makes switching branches unsafe. */
export type Operation = 'rebase' | 'merge' | 'cherry-pick' | 'revert';

export interface RefLabel {
	/** Name as typed on the command line: `feature` or `origin/feature`. */
	name: string;
	remote: boolean;
	/** The checked-out branch. */
	head: boolean;
	trunk: boolean;
}

export interface GraphCommit {
	hash: string;
	/** All parents, including ones not shown in the graph. */
	parents: string[];
	author: string;
	/** Unix seconds. */
	authorTime: number;
	subject: string;
	body: string;
	sync: SyncState;
	refs: RefLabel[];
	row: number;
	lane: number;
}

export interface BranchOption {
	name: string;
	/** Unix seconds of the tip commit. */
	committerTime: number;
}

export interface GraphData {
	/** Trunk as typed on the command line (`origin/main`), or null when none was found. */
	trunk: string | null;
	head: {
		hash: string;
		/** Null when HEAD is detached. */
		branch: string | null;
	};
	operation: Operation | null;
	/** Local branches, most recently committed first. */
	branches: BranchOption[];
	/** In row order, top to bottom. */
	commits: GraphCommit[];
	lanes: number;
	/** A short note shown above the graph, such as a missing trunk. */
	notice: string | null;
}

export type HostMessage =
	| { type: 'graph'; data: GraphData }
	/** Nothing to draw: no repository, no commits, or an error. */
	| { type: 'empty'; message: string }
	/** Background fetch result. A message means the remote state may be out of date. */
	| { type: 'stale'; message: string | null };

export type WebviewMessage =
	| { type: 'ready' }
	| { type: 'checkout'; branch: string }
	| { type: 'openDiff'; hash: string };
