import { useMemo } from 'react'
import type { HangulCompositionInputs } from '@/font/composer'
import { learnCompositionProfile, shapesFromRequestDrawings, toRequestDrawings } from '@/font/composition-inputs'
import { visualCalibrationScale } from '@/font/visual-calibration'
import type { CompositionSettings, DrawingRecord, WritingSessionRecord } from '@/types/project'

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
  const composition = useMemo<HangulCompositionInputs>(() => ({
    compositionSettings: settings,
    gaps: profile.gaps,
    proportions: profile.proportions,
    hangulTargetHeight: profile.hangulTargetHeight,
    hangulTargetCenter: profile.hangulTargetCenter,
  }), [profile, settings])
  const visualScale = useMemo(
    () => visualCalibrationScale(shapes, settings, profile.gaps, profile.hangulTargetHeight, profile.hangulTargetCenter, profile.proportions),
    // A frozen context keeps the calibration it started with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [freezeKey ?? shapes, settings, profile],
  )
  return { shapes, composition, visualScale }
}
