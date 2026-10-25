import { useMemo } from 'react';
import type { DrawingRecord, WritingSessionRecord } from '@/collection/records';
import { visualCalibrationScale } from '@/font/glyphs/calibration';
import type { CompositionSettings } from '@/font/settings';
import { hangulComposeOptions, withSizeTargets, type HangulCompositionInputs } from './font-builder';
import { latestOnly } from '@/lib/latest-only';
import type { CompositionProfile } from './request';
import { learnCompositionProfile, shapesFromRequestDrawings, toRequestDrawings } from './inputs';

type Drawings = Record<string, DrawingRecord>;
type Sessions = Record<string, WritingSessionRecord>;

const cachedShapes = latestOnly((drawings: Drawings, sessions: Sessions, _stabilization: number, _doubleConsonantGap: number, settings: CompositionSettings) => shapesFromRequestDrawings(toRequestDrawings(drawings, sessions), settings), 4);
const compositions = new WeakMap<CompositionProfile, { settings: CompositionSettings; value: HangulCompositionInputs }>();

/** One composition per profile, so a frozen profile and a fresh one can both stay cached. */
function cachedComposition(profile: CompositionProfile, settings: CompositionSettings) {
	const cached = compositions.get(profile);
	if (cached?.settings === settings) return cached.value;
	const value: HangulCompositionInputs = { ...profile, compositionSettings: settings };
	compositions.set(profile, { settings, value });
	return value;
}
const cachedProfile = latestOnly((sessions: Sessions, _stabilization: number, settings: CompositionSettings) => learnCompositionProfile(sessions, settings), 2);

/** The shapes the font is composed from, for reading where their ink came from. */
export function compositionShapes(drawings: Drawings, sessions: Sessions, settings: CompositionSettings) {
	return cachedShapes(drawings, sessions, settings.endpointStabilization, settings.doubleConsonantGap, settings);
}

/** Computes ahead of time what the next sentence will ask for, so opening it finds the result ready. */
export function warmCompositionBase(drawings: Drawings, sessions: Sessions, settings: CompositionSettings) {
	const shapes = cachedShapes(drawings, sessions, settings.endpointStabilization, settings.doubleConsonantGap, settings);
	const composition = cachedComposition(cachedProfile(sessions, settings.endpointStabilization, settings), settings);
	return { shapes, composition };
}

/**
 * The shapes and learned profile the font worker will use.
 *
 * With a `freezeKey`, the learned profile is computed once per key: writing
 * (and learning from) other syllables then never moves a guide on screen.
 * Shapes stay live, so newly captured jamo appear at once.
 */
export function useCompositionBase(drawings: Drawings, sessions: Sessions, settings: CompositionSettings, freezeKey?: string) {
	const shapes = cachedShapes(drawings, sessions, settings.endpointStabilization, settings.doubleConsonantGap, settings);
	const profile = useMemo(
		() => cachedProfile(sessions, settings.endpointStabilization, settings),
		// Only the stroke conditioning setting changes what is learned.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[freezeKey ?? sessions, settings.endpointStabilization]
	);
	const composition = cachedComposition(profile, settings);
	return { shapes, profile, composition };
}

/** The shapes, learned profile and calibration the font worker will use. */
export function useCompositionContext(drawings: Drawings, sessions: Sessions, settings: CompositionSettings) {
	const base = useCompositionBase(drawings, sessions, settings);
	const { shapes, profile } = base;
	const composition = useMemo(() => withSizeTargets(shapes, base.composition), [shapes, base.composition]);
	const visualScale = useMemo(() => visualCalibrationScale(shapes, settings, hangulComposeOptions(profile)), [shapes, settings, profile]);
	return { shapes, composition, visualScale };
}
