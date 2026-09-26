import { useMemo } from 'react'
import type { HangulCompositionInputs } from '@/font/composer'
import { buildGenerationInputs, shapesFromRequestDrawings } from '@/font/composition-inputs'
import { visualCalibrationScale } from '@/font/visual-calibration'
import type { CompositionSettings, DrawingRecord, WritingSessionRecord } from '@/types/project'

/** The same shapes, learned profile and calibration the font worker will use. */
export function useCompositionContext(drawings: Record<string, DrawingRecord>, sessions: Record<string, WritingSessionRecord>, settings: CompositionSettings) {
  const inputs = useMemo(
    () => buildGenerationInputs(drawings, sessions, settings),
    // Only the stroke conditioning setting changes what is learned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawings, sessions, settings.endpointStabilization],
  )
  const shapes = useMemo(
    () => shapesFromRequestDrawings(inputs.drawings, settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputs.drawings, settings.endpointStabilization],
  )
  const composition = useMemo<HangulCompositionInputs>(() => ({
    compositionSettings: settings,
    gaps: inputs.gaps,
    proportions: inputs.proportions,
    hangulTargetHeight: inputs.hangulTargetHeight,
    hangulTargetCenter: inputs.hangulTargetCenter,
    lockedSyllables: inputs.lockedSyllables,
  }), [inputs, settings])
  const visualScale = useMemo(
    () => visualCalibrationScale(shapes, settings, inputs.gaps, inputs.hangulTargetHeight, inputs.hangulTargetCenter, inputs.proportions),
    [shapes, settings, inputs],
  )
  return { shapes, composition, visualScale }
}
