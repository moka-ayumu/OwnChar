/** The result of `compute` for the latest inputs, judged by the first `keyed` arguments; the same inputs give back the same object across mounts. */
export function latestOnly<Args extends unknown[], Result>(compute: (...args: Args) => Result, keyed: number) {
	let last: { args: Args; result: Result } | undefined;
	return (...args: Args) => {
		if (last && last.args.slice(0, keyed).every((arg, index) => Object.is(arg, args[index]))) return last.result;
		last = { args, result: compute(...args) };
		return last.result;
	};
}
