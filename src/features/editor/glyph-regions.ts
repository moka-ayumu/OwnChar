import opentype from 'opentype.js';
import type { Box } from '@/font/geometry/path-ops';
import { HANGUL_ROLES, type HangulRole } from '@/font/hangul';

/** The outlines of a glyph that belong together, with the parts of the glyph they hold ink of: a role (`final`) or one jamo of a role built from two (`final:1`). */
export interface GlyphRegion {
	commands: opentype.PathCommand[];
	keys: string[];
}

/** A role holds a region when this share of the smaller of the two boxes lies in both. */
const SHARE = 0.5;

function boundsOf(commands: opentype.PathCommand[]): Box {
	const path = new opentype.Path();
	path.commands = commands;
	const { x1, y1, x2, y2 } = path.getBoundingBox();
	return { x1, y1, x2, y2 };
}

const area = (box: Box) => Math.max(0, box.x2 - box.x1) * Math.max(0, box.y2 - box.y1);
const overlap = (a: Box, b: Box) => area({ x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), x2: Math.min(a.x2, b.x2), y2: Math.min(a.y2, b.y2) });
const contains = (outer: Box, inner: Box) => outer.x1 <= inner.x1 && outer.y1 <= inner.y1 && outer.x2 >= inner.x2 && outer.y2 >= inner.y2;

function union(boxes: Box[]): Box {
	return { x1: Math.min(...boxes.map((box) => box.x1)), y1: Math.min(...boxes.map((box) => box.y1)), x2: Math.max(...boxes.map((box) => box.x2)), y2: Math.max(...boxes.map((box) => box.y2)) };
}

type Group = { commands: opentype.PathCommand[]; box: Box };

/** Tells apart the `count` jamo a role is built from, side by side from left to right, at the widest gaps between its groups. */
function splitSideBySide(groups: Group[], count: number): Group[][] {
	const sorted = [...groups].sort((a, b) => a.box.x1 - b.box.x1);
	const cuts: number[] = [];
	for (let cut = 1; cut < count && sorted.length > count - cut; cut += 1) {
		const from = cuts.at(-1) ?? 0;
		let best = from + 1;
		let gap = -Infinity;
		for (let index = from + 1; index <= sorted.length - (count - cut); index += 1) {
			const width = sorted[index].box.x1 - Math.max(...sorted.slice(from, index).map((group) => group.box.x2));
			if (width > gap) [best, gap] = [index, width];
		}
		cuts.push(best);
	}
	return [0, ...cuts].map((start, index) => sorted.slice(start, cuts[index] ?? sorted.length));
}

/**
 * Splits a glyph into the outlines that belong together (a contour with the holes inside it) and tells which jamo
 * roles each holds. A role in `parts` is built from that many jamo, and its outlines are told apart when they can be. `roleBoxes` is where the composer laid each role out; it is fitted to the box of the glyph, which
 * the font may have scaled and moved since. Without it the glyph is one region.
 */
export function glyphRegions(commands: opentype.PathCommand[], roleBoxes: Partial<Record<HangulRole, Box>> | undefined, parts: Partial<Record<HangulRole, number>> = {}): GlyphRegion[] {
	const placed = HANGUL_ROLES.filter((role) => roleBoxes?.[role]);
	if (!roleBoxes || !placed.length) return [{ commands, keys: [] }];

	const contours: { commands: opentype.PathCommand[]; box: Box }[] = [];
	for (const command of commands) {
		if (command.type === 'M') contours.push({ commands: [], box: { x1: 0, y1: 0, x2: 0, y2: 0 } });
		contours[contours.length - 1]?.commands.push(command);
	}
	contours.forEach((contour) => (contour.box = boundsOf(contour.commands)));

	const groups: Group[] = [];
	for (const contour of [...contours].sort((a, b) => area(b.box) - area(a.box))) {
		const host = groups.filter((group) => contains(group.box, contour.box)).sort((a, b) => area(a.box) - area(b.box))[0];
		if (host) host.commands.push(...contour.commands);
		else groups.push({ commands: [...contour.commands], box: contour.box });
	}

	const glyph = union(groups.map((group) => group.box));
	const laid = union(placed.map((role) => roleBoxes[role]!));
	const fit = (value: number, from1: number, from2: number, to1: number, to2: number) => (from2 === from1 ? to1 : to1 + ((value - from1) / (from2 - from1)) * (to2 - to1));
	const fitted = Object.fromEntries(
		placed.map((role) => {
			const box = roleBoxes[role]!;
			return [role, { x1: fit(box.x1, laid.x1, laid.x2, glyph.x1, glyph.x2), x2: fit(box.x2, laid.x1, laid.x2, glyph.x1, glyph.x2), y1: fit(box.y1, laid.y1, laid.y2, glyph.y1, glyph.y2), y2: fit(box.y2, laid.y1, laid.y2, glyph.y1, glyph.y2) }];
		})
	) as Record<HangulRole, Box>;

	const held = groups.map((group) => {
		const shares = placed.map((role) => ({ role, share: overlap(group.box, fitted[role]) / Math.max(1e-6, Math.min(area(group.box), area(fitted[role]))) }));
		const roles = shares.filter((item) => item.share >= SHARE).map((item) => item.role);
		return { group, roles: roles.length ? roles : [shares.sort((a, b) => b.share - a.share)[0].role] };
	});
	const regions: GlyphRegion[] = [];
	const split = new Set<HangulRole>();
	for (const item of held) {
		const [role] = item.roles;
		const count = parts[role] ?? 1;
		if (item.roles.length > 1 || count < 2) regions.push({ commands: item.group.commands, keys: item.roles });
		else if (!split.has(role)) {
			split.add(role);
			const own = held.filter((other) => other.roles.length === 1 && other.roles[0] === role).map((other) => other.group);
			const sides = splitSideBySide(own, count);
			if (sides.length === count && sides.every((side) => side.length)) sides.forEach((side, index) => regions.push({ commands: side.flatMap((group) => group.commands), keys: [`${role}:${index}`] }));
			else own.forEach((group) => regions.push({ commands: group.commands, keys: [role] }));
		}
	}
	return regions;
}
