export interface CompositionSettings {
  endpointStabilization: number
  singleInitialScale: number
  vowelScale: number
  finalScale: number
  hangulNormalization: number
  /** How far, from 0 to 2, each jamo of a syllable is drawn toward the mean size of its role, and the syllable toward the mean width, in its layout. */
  initialNormalization: number
  medialNormalization: number
  finalNormalization: number
  widthNormalization: number
  jamoNormalization: number
  standaloneJamoMaxHeight: number
  latinNormalization: number
  verticalAlignment: number
  widthMode: 'proportional' | 'fixed'
}

export const DEFAULT_COMPOSITION_SETTINGS: CompositionSettings = {
  endpointStabilization: 1,
  singleInitialScale: 1,
  vowelScale: 1,
  finalScale: 1,
  hangulNormalization: 0.8,
  initialNormalization: 1,
  medialNormalization: 1,
  finalNormalization: 1,
  widthNormalization: 1,
  jamoNormalization: 1,
  standaloneJamoMaxHeight: 1,
  latinNormalization: 0,
  verticalAlignment: 0.8,
  widthMode: 'proportional',
}
