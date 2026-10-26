import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** Names the build for Sentry: the commit on Cloudflare Pages, the package version elsewhere. */
const release = process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) ?? process.env.npm_package_version ?? 'dev';
const { SENTRY_AUTH_TOKEN: authToken, SENTRY_ORG: org, SENTRY_PROJECT: project } = process.env;
/** Source maps go to Sentry only when the build can upload them, and never ship with the site. */
const uploadSourceMaps = Boolean(authToken && org && project);

/** Vertical metrics that centre the Hangul ink in the line box, so an icon next to the text lines up. */
const fontMetrics: Record<string, string> = {
	'noto-sans-kr': 'ascent-override: 110%; descent-override: 35%; line-gap-override: 0%;',
	'ibm-plex-sans-kr': 'ascent-override: 107%; descent-override: 44%; line-gap-override: 0%;'
};

export default defineConfig({
	plugins: [
		{
			name: 'centre-hangul-fonts',
			enforce: 'pre',
			transform(code, id) {
				const family = Object.keys(fontMetrics).find((name) => id.includes(`/${name}/`) && id.endsWith('.css'));
				if (family) return code.replaceAll('font-display: swap;', `font-display: swap; ${fontMetrics[family]}`);
			}
		},
		{
			name: 'isolate-module-server-cache',
			config(config) {
				// Module servers started by scripts must not replace the running app's optimized dependencies.
				if (config.server?.middlewareMode && !config.cacheDir) {
					return { cacheDir: `node_modules/.vite-ssr/${process.pid}` };
				}
			}
		},
		tanstackRouter({ target: 'react', autoCodeSplitting: true }),
		react(),
		tailwindcss(),
		uploadSourceMaps && sentryVitePlugin({ authToken, org, project, release: { name: release }, sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] }, telemetry: false })
	],
	build: { sourcemap: uploadSourceMaps ? 'hidden' : false },
	define: { __APP_RELEASE__: JSON.stringify(release) },
	resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
	test: { include: ['tests/unit/**/*.test.ts'] }
});
