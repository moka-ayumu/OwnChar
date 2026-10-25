import { useCallback, useLayoutEffect, useRef } from 'react';

/** A function that never changes identity yet always calls the latest `callback`. */
export function useStableCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
	const latest = useRef(callback);
	useLayoutEffect(() => {
		latest.current = callback;
	});
	return useCallback((...args: Args) => latest.current(...args), []);
}
