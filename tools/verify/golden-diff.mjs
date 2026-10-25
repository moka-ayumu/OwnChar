// node tools/verify/golden-diff.mjs golden-base.json golden-new.json
// Reports where two snapshots of golden.mjs differ. Fields missing from the second are listed, not compared.
import { readOutJson } from '../lib/out.mjs';

const [a, b] = process.argv.slice(2).map(readOutJson);
let differences = 0;
let largest = 0;
const missing = new Set();
const report = (path, x, y) => {
	if (differences <= 5) console.log(`  ${path}: ${x} -> ${y}`);
};
const walk = (x, y, path) => {
	if (y === undefined) {
		missing.add(path.replace(/\.[^.]*$/, '').replace(/\d+/g, '#'));
		return;
	}
	if (typeof x === 'number' && typeof y === 'number') {
		if (x !== y) {
			differences += 1;
			largest = Math.max(largest, Math.abs(x - y));
			report(path, x, y);
		}
		return;
	}
	if (x && typeof x === 'object') {
		for (const key of Object.keys(x)) walk(x[key], y?.[key], `${path}.${key}`);
		return;
	}
	if (x !== y) {
		differences += 1;
		report(path, x, y);
	}
};
walk(a, b, '');
console.log(`${differences} differing values, largest ${largest}; removed: ${[...missing].join(', ') || 'none'}`);
