import { execFileSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { createServer } from 'vite';

/** Starts a Vite server in middleware mode. With `revision`, files under src/ come from that Git revision. */
export function startVite({ revision = '' } = {}) {
	const sourceCache = new Map();
	const committedSources = {
		name: 'committed-sources',
		enforce: 'pre',
		load(id) {
			const file = relative(resolve('.'), id.split('?')[0]).replaceAll('\\', '/');
			if (!file.startsWith('src/')) return;
			if (!sourceCache.has(file)) sourceCache.set(file, execFileSync('git', ['show', `${revision}:${file}`], { encoding: 'utf8' }));
			return sourceCache.get(file);
		}
	};
	return createServer({
		plugins: revision ? [committedSources] : [],
		server: { middlewareMode: true, hmr: false },
		optimizeDeps: { noDiscovery: true },
		appType: 'custom',
		logLevel: 'error'
	});
}
