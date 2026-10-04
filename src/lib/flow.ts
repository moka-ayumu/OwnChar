/** Where the sentence canvas sat inside the stage when generation was started from the writing page. */
export interface StageOrigin {
  exerciseId: string
  /** The canvas frame, relative to the stage. */
  frame: { x: number; y: number; width: number; height: number }
  /** The part of the stage the canvas was visible in. */
  clip: { x: number; y: number; width: number; height: number }
}

let origin: StageOrigin | null = null
let typedArrival = false

/** One-shot hand-offs between the writing, generation and preview pages, so each can pick up where the last left off. */
export const flow = {
  leaveWriting(value: StageOrigin | null) { origin = value },
  takeOrigin() { const value = origin; origin = null; return value },
  finishGeneration() { typedArrival = true },
  takeTypedArrival() { const value = typedArrival; typedArrival = false; return value },
}

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
