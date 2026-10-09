export interface IdleHandle { id: number; idle?: boolean }

export interface IdleTime { timeRemaining(): number }

/** Runs `task` when the browser is idle, or soon after where idle callbacks do not exist. */
export function whenIdle(task: (time: IdleTime) => void): IdleHandle {
  if ((window as Partial<Window>).requestIdleCallback) return { id: window.requestIdleCallback(task, { timeout: 1000 }), idle: true }
  return { id: window.setTimeout(() => { const end = performance.now() + 10; task({ timeRemaining: () => Math.max(0, end - performance.now()) }) }, 50) }
}

export function cancelIdle({ id, idle }: IdleHandle) {
  if (idle) window.cancelIdleCallback(id)
  else window.clearTimeout(id)
}

/** For a task that works in steps: stops after one step at least, and before the idle time is spent. */
export function stopWhenBusy(time: IdleTime) {
  let steps = 0
  return () => steps++ > 0 && time.timeRemaining() < 4
}
