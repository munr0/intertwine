import { execFile } from 'child_process';

export class GitError extends Error {
	constructor(readonly args: readonly string[], readonly stderr: string) {
		super(stderr.trim() || `git ${args[0]} failed`);
	}
}

export interface RunOptions {
	/** Written to stdin, for `--stdin` commands. */
	input?: string;
	timeoutMs?: number;
}

/** Runs git commands in one repository. No VS Code dependencies. */
export class Git {
	constructor(readonly cwd: string, readonly gitPath = 'git') {}

	run(args: string[], options: RunOptions = {}): Promise<string> {
		return new Promise((resolve, reject) => {
			const child = execFile(this.gitPath, args, {
				cwd: this.cwd,
				encoding: 'utf8',
				maxBuffer: 512 * 1024 * 1024,
				timeout: options.timeoutMs,
				// Never block on a credential prompt; fail instead.
				env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
			}, (error, stdout, stderr) => {
				if (error) {
					reject(new GitError(args, stderr || error.message));
				} else {
					resolve(stdout);
				}
			});
			// If git exits before reading stdin, the write fails with EPIPE; the exit callback reports it.
			child.stdin?.on('error', () => {});
			child.stdin?.end(options.input ?? '');
		});
	}

	/** Like `run`, but resolves to null instead of rejecting. For probes such as `rev-parse --verify`. */
	async tryRun(args: string[]): Promise<string | null> {
		try {
			return await this.run(args);
		} catch {
			return null;
		}
	}
}
