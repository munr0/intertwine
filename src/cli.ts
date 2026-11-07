// Prints the graph for a repository as JSON, without VS Code. For debugging the core:
//   npm run compile-tests && node out/cli.js [repo] [--trunk <ref>] [--context <n>]
import { Git } from './core/git';
import { buildGraph } from './core/graph';

async function main(args: string[]) {
	const option = (flag: string) => {
		const i = args.indexOf(flag);
		return i >= 0 ? args.splice(i, 2)[1] : undefined;
	};
	const trunk = option('--trunk');
	const context = option('--context');
	const graph = await buildGraph(new Git(args[0] ?? process.cwd()), {
		trunk,
		trunkContext: context === undefined ? undefined : Number(context),
	});
	process.stdout.write(JSON.stringify(graph, null, '\t') + '\n');
}

main(process.argv.slice(2)).catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
