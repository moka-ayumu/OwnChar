export interface CompositionSettings {
  endpointStabilization: number
  singleInitialScale: number
  vowelScale: number
  finalScale: number
  hangulNormalization: number
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
  jamoNormalization: 1,
  standaloneJamoMaxHeight: 1,
  latinNormalization: 0,
  verticalAlignment: 0.8,
  widthMode: 'proportional',
}
