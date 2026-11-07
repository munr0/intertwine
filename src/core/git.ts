import { spawn } from 'child_process';
import * as path from 'path';

export class GitError extends Error {
	constructor(args: readonly string[], readonly stderr: string) {
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
			const child = spawn(this.gitPath, args, {
				cwd: this.cwd,
				// Only open stdin when there is input: closing an unused pipe races git's exit and raises SIGPIPE.
				stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
				timeout: options.timeoutMs,
				// Never block on a credential prompt; fail instead.
				env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
			});
			const stdout: Buffer[] = [];
			const stderr: Buffer[] = [];
			child.stdout!.on('data', (chunk: Buffer) => stdout.push(chunk));
			child.stderr!.on('data', (chunk: Buffer) => stderr.push(chunk));
			child.on('error', error => reject(new GitError(args, error.message)));
			child.on('close', (code, signal) => {
				if (code === 0) {
					resolve(Buffer.concat(stdout).toString('utf8'));
				} else {
					reject(new GitError(args, Buffer.concat(stderr).toString('utf8') || `exited with ${signal ?? code}`));
				}
			});
			if (options.input !== undefined) {
				// If git exits before reading all of it, the write fails with EPIPE; 'close' reports the exit.
				child.stdin!.on('error', () => {});
				child.stdin!.end(options.input);
			}
		});
	}

	/** Absolute paths of this worktree's git directory and the directory shared by all worktrees. */
	async dirs(): Promise<{ gitDir: string; commonDir: string }> {
		const [gitDir, commonDir] = (await this.run(['rev-parse', '--absolute-git-dir', '--git-common-dir'])).split('\n');
		return { gitDir, commonDir: path.resolve(this.cwd, commonDir) };
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
