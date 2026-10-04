/** Where the sentence canvas sat inside the stage when generation was started from the writing page. */
export interface StageOrigin {
  exerciseId: string
  /** The canvas frame, relative to the stage. */
  frame: { x: number; y: number; width: number; height: number }
  /** The part of the stage the canvas was visible in. */
  clip: { x: number; y: number; width: number; height: number }
}

/** The sentence generation ends on and the preview opens with, and the size both set it at. */
export const LEAD_SENTENCE = '오늘 하루도 좋은 하루 보내세요.'
export const LEAD_SIZE = 80

let origin: StageOrigin | null = null

/** One-shot hand-off from the writing page to generation, so the film opens on the sentence where it was left. */
export const flow = {
  leaveWriting(value: StageOrigin | null) { origin = value },
  takeOrigin() { const value = origin; origin = null; return value },
}

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
