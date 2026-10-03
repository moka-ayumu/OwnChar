import { useMemo } from 'react'
import type { DrawingRecord, WritingSessionRecord } from '@/collection/records'
import { visualCalibrationScale } from '@/font/glyphs/calibration'
import type { CompositionSettings } from '@/font/settings'
import { hangulComposeOptions, type HangulCompositionInputs } from './font-builder'
import { learnCompositionProfile, shapesFromRequestDrawings, toRequestDrawings } from './inputs'

/**
 * The same shapes, learned profile and calibration the font worker will use.
 *
 * With a `freezeKey`, the learned profile and calibration are computed once
 * per key: writing (and learning from) other syllables then never moves a
 * guide on screen. Shapes stay live, so newly captured jamo appear at once.
 */
export function useCompositionContext(drawings: Record<string, DrawingRecord>, sessions: Record<string, WritingSessionRecord>, settings: CompositionSettings, freezeKey?: string) {
  const requestDrawings = useMemo(() => toRequestDrawings(drawings, sessions), [drawings, sessions])
  const shapes = useMemo(
    () => shapesFromRequestDrawings(requestDrawings, settings),
    // Only the stroke conditioning setting changes the normalized shapes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requestDrawings, settings.endpointStabilization],
  )
  const profile = useMemo(
    () => learnCompositionProfile(sessions, settings),
    // Only the stroke conditioning setting changes what is learned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [freezeKey ?? sessions, settings.endpointStabilization],
  )
  const composition = useMemo<HangulCompositionInputs>(() => ({ ...profile, compositionSettings: settings }), [profile, settings])
  const visualScale = useMemo(
    () => visualCalibrationScale(shapes, settings, hangulComposeOptions(profile)),
    // A frozen context keeps the calibration it started with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [freezeKey ?? shapes, settings, profile],
  )
  return { shapes, composition, visualScale }
}
