import * as Sentry from '@sentry/react';

const OPT_OUT_KEY = 'ownchar:telemetry-opt-out';

/** The choice made on this page, for a browser that cannot store it. */
let chosen: boolean | undefined;

/** Whether the visitor has refused collection on this browser. */
export function isTelemetryOptedOut() {
	if (chosen !== undefined) return chosen;
	try {
		return window.localStorage.getItem(OPT_OUT_KEY) === '1';
	} catch {
		return false;
	}
}

/** Refuses or allows collection from now on. The choice stays on this browser and holds at once. */
export function setTelemetryOptOut(optOut: boolean) {
	chosen = optOut;
	try {
		if (optOut) window.localStorage.setItem(OPT_OUT_KEY, '1');
		else window.localStorage.removeItem(OPT_OUT_KEY);
	} catch {
		// Without storage the choice lasts until the page closes.
	}
}

/**
 * Starts Sentry when VITE_SENTRY_DSN is set. In development it also feeds a
 * local Spotlight viewer (`pnpm spotlight`), which needs no DSN.
 */
export function initializeTelemetry() {
	const dsn = import.meta.env.VITE_SENTRY_DSN;
	const spotlight = import.meta.env.DEV;
	if (!dsn && !spotlight) return;
	Sentry.init({
		dsn,
		integrations: spotlight ? [Sentry.spotlightBrowserIntegration()] : [],
		environment: import.meta.env.MODE,
		release: __APP_RELEASE__,
		dataCollection: { userInfo: false },
		ignoreErrors: ['ResizeObserver loop'],
		beforeSend: (event) => (isTelemetryOptedOut() ? null : event),
		beforeBreadcrumb: (breadcrumb) => (isTelemetryOptedOut() ? null : breadcrumb),
		beforeSendMetric: (metric) => (isTelemetryOptedOut() ? null : metric)
	});
}

/** For the `onUncaughtError` of `createRoot`: reports a render error with its component stack. */
export const reportRenderError = Sentry.reactErrorHandler((error) => console.error(error));

/** Names the screen the visitor is on, for the errors that follow. */
export function setView(name: string) {
	Sentry.setTag('view', name);
}

/** A step of the visitor's way through the app, kept for the errors that follow. */
export function trackEvent(name: string, attributes?: Record<string, string | number>) {
	Sentry.addBreadcrumb({ category: 'app', message: name, data: attributes, level: 'info' });
}

const FIRST_GENERATION_KEY = 'ownchar:first-generation-sent';

/** Whether this browser tab has already counted a first generation. */
let firstGenerationCounted = false;

/** Counts a finished font generation, and the first one of this tab's session apart. */
export function recordGenerationCompleted() {
	Sentry.metrics.count('font_generated', 1);
	if (firstGenerationCounted) return;
	firstGenerationCounted = true;
	try {
		if (window.sessionStorage.getItem(FIRST_GENERATION_KEY)) return;
		window.sessionStorage.setItem(FIRST_GENERATION_KEY, '1');
	} catch {
		// Without storage the first generation is counted once per page load.
	}
	Sentry.metrics.count('font_first_generated', 1);
}

const reported = new Set<string>();

/**
 * A failure of the app, named by `code` so that it groups under one issue. A
 * code is sent once per kind of error in a visit, so a failing autosave does
 * not flood.
 */
export function reportError(code: string, error: unknown, context?: Record<string, string | number>) {
	const kind = error instanceof Error ? error.name : typeof error;
	const key = `${code}:${kind}`;
	if (reported.has(key)) return;
	reported.add(key);
	Sentry.withScope((scope) => {
		scope.setTag('code', code);
		scope.setFingerprint([code, kind]);
		if (context) scope.setContext('app', context);
		Sentry.captureException(error instanceof Error ? error : new Error(code));
	});
}
