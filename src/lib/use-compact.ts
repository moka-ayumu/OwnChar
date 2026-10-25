import { useSyncExternalStore } from 'react';

/** Keep in step with the `max-width: 767px` block of `styles.css`. */
const COMPACT_QUERY = '(max-width: 767px)';

function subscribe(notify: () => void) {
	const list = window.matchMedia(COMPACT_QUERY);
	list.addEventListener('change', notify);
	return () => list.removeEventListener('change', notify);
}

/**
 * Whether the screen is phone-narrow. It changes only where the width crosses
 * the threshold, so dragging a window edge costs no render per pixel.
 */
export function useCompact() {
	return useSyncExternalStore(
		subscribe,
		() => window.matchMedia(COMPACT_QUERY).matches,
		() => false
	);
}
