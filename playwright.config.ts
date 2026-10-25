import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: false,
	retries: process.env.CI ? 2 : 0,
	reporter: [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL: 'http://127.0.0.1:4173',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		// Touch input only matters where the writer draws.
		{ name: 'tablet', use: { ...devices['iPad Pro 11'] }, testMatch: /writing\.spec\.ts/ }
	],
	webServer: {
		command: 'pnpm build && pnpm preview --host 127.0.0.1',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
