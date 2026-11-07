export interface LayoutCommit {
	hash: string;
	parents: string[];
	/** Unix seconds; newer commits sort higher when topology allows. */
	commitTime: number;
}

export interface Layout {
	row: Map<string, number>;
	lane: Map<string, number>;
	lanes: number;
}

/**
 * Assigns each commit a row (children always above parents, newest first otherwise) and a lane.
 *
 * Lanes come from first-parent chains walked from `tips` in order. The first `pinned` tips
 * that produce a chain get lanes 0, 1, … to themselves (trunk, then the selected branch);
 * every other chain shares the remaining lanes wherever its rows don't overlap another's.
 */
export function layout(commits: LayoutCommit[], tips: string[], pinned: number): Layout {
	const byHash = new Map(commits.map(c => [c.hash, c]));
	const row = orderRows(commits, byHash);

	// Walk first-parent chains: the given tips first, then whatever is left, top to bottom.
	const chainOf = new Map<string, number>();
	const chains: string[][] = [];
	let pinnedChains = 0;
	const walk = (tip: string): boolean => {
		const chain: string[] = [];
		let hash: string | undefined = tip;
		while (hash !== undefined && byHash.has(hash) && !chainOf.has(hash)) {
			chainOf.set(hash, chains.length);
			chain.push(hash);
			hash = byHash.get(hash)!.parents[0];
		}
		if (chain.length > 0) {
			chains.push(chain);
		}
		return chain.length > 0;
	};
	tips.forEach((tip, i) => {
		if (walk(tip) && i < pinned) {
			pinnedChains++;
		}
	});
	for (const hash of [...byHash.keys()].sort((a, b) => row.get(a)! - row.get(b)!)) {
		walk(hash);
	}

	// Rows each chain's lane is busy for, including the edges drawn in that lane:
	// a branch-off edge runs down the child's lane, a merge edge down the parent's.
	const top = chains.map(chain => row.get(chain[0])!);
	const bottom = chains.map(chain => row.get(chain[chain.length - 1])!);
	for (const commit of commits) {
		const childChain = chainOf.get(commit.hash)!;
		commit.parents.forEach((parent, i) => {
			const parentChain = chainOf.get(parent);
			if (parentChain === undefined || parentChain === childChain) {
				return;
			}
			if (i === 0) {
				bottom[childChain] = Math.max(bottom[childChain], row.get(parent)!);
			} else {
				top[parentChain] = Math.min(top[parentChain], row.get(commit.hash)!);
			}
		});
	}

	const laneOfChain: number[] = [];
	const busy: Array<Array<[number, number]>> = [];
	for (let i = 0; i < pinnedChains; i++) {
		laneOfChain[i] = i;
		busy.push([[-Infinity, Infinity]]);
	}
	const rest = chains.map((_, i) => i).slice(pinnedChains).sort((a, b) => top[a] - top[b]);
	for (const chain of rest) {
		let lane = pinnedChains;
		while (busy[lane]?.some(([t, b]) => top[chain] <= b && bottom[chain] >= t)) {
			lane++;
		}
		(busy[lane] ??= []).push([top[chain], bottom[chain]]);
		laneOfChain[chain] = lane;
	}

	const lane = new Map<string, number>();
	for (const [hash, chain] of chainOf) {
		lane.set(hash, laneOfChain[chain]);
	}
	return { row, lane, lanes: busy.length };
}

/** Topological order (children before parents), newest commit first among those ready. */
function orderRows(commits: LayoutCommit[], byHash: Map<string, LayoutCommit>): Map<string, number> {
	const pendingChildren = new Map(commits.map(c => [c.hash, 0]));
	for (const commit of commits) {
		for (const parent of new Set(commit.parents)) {
			if (byHash.has(parent)) {
				pendingChildren.set(parent, pendingChildren.get(parent)! + 1);
			}
		}
	}
	const index = new Map(commits.map((c, i) => [c.hash, i]));
	const before = (a: LayoutCommit, b: LayoutCommit) =>
		a.commitTime !== b.commitTime ? a.commitTime > b.commitTime : index.get(a.hash)! < index.get(b.hash)!;
	const ready = new Heap(before);
	for (const commit of commits) {
		if (pendingChildren.get(commit.hash) === 0) {
			ready.push(commit);
		}
	}
	const row = new Map<string, number>();
	while (ready.size > 0) {
		const commit = ready.pop();
		row.set(commit.hash, row.size);
		for (const parent of new Set(commit.parents)) {
			const left = pendingChildren.get(parent);
			if (left === undefined) {
				continue;
			}
			pendingChildren.set(parent, left - 1);
			if (left === 1) {
				ready.push(byHash.get(parent)!);
			}
		}
	}
	return row;
}

class Heap<T> {
	private items: T[] = [];
	constructor(private readonly before: (a: T, b: T) => boolean) {}

	get size() {
		return this.items.length;
	}

	push(item: T) {
		const items = this.items;
		items.push(item);
		let i = items.length - 1;
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (!this.before(items[i], items[parent])) {
				break;
			}
			[items[i], items[parent]] = [items[parent], items[i]];
			i = parent;
		}
	}

	pop(): T {
		const items = this.items;
		const first = items[0];
		const last = items.pop()!;
		if (items.length > 0) {
			items[0] = last;
			let i = 0;
			for (;;) {
				const l = 2 * i + 1;
				const r = l + 1;
				let best = i;
				if (l < items.length && this.before(items[l], items[best])) {
					best = l;
				}
				if (r < items.length && this.before(items[r], items[best])) {
					best = r;
				}
				if (best === i) {
					break;
				}
				[items[i], items[best]] = [items[best], items[i]];
				i = best;
			}
		}
		return first;
	}
}
