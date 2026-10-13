import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { prefersReducedMotion } from '@/lib/flow'
import { buildHomeFilm, drawHomeFilm, HOME_CUES, HOME_LENGTH, HOME_STILLS, homeScene, type HomeFilmData, type HomeFilmSource } from './home-film'

const files = import.meta.glob<HomeFilmSource>('../samples/home-film.json', { import: 'default' })
/** Space kept between the film and the panel under it. */
const FLOOR_GAP = 24

/** Plays the home film on `canvas`, above `foot`. With reduced motion it shows one still of the chosen scene. */
export function useHomeFilm(canvas: RefObject<HTMLCanvasElement | null>, foot: RefObject<HTMLElement | null>) {
  const [still] = useState(prefersReducedMotion)
  const [scene, setScene] = useState(still ? HOME_CUES.length - 1 : 0)
  const [paused, setPaused] = useState(false)
  const data = useRef<HomeFilmData | null>(null)
  const clock = useRef({ time: still ? HOME_STILLS[HOME_STILLS.length - 1] : 0, played: 0, line: 0, last: 0, paused: false })
  const redraw = useRef(() => {})

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    let frame = 0
    let alive = true
    const draw = () => {
      if (!data.current) return
      const dpr = window.devicePixelRatio || 1
      const { clientWidth: width, clientHeight: height } = element
      if (element.width !== Math.round(width * dpr) || element.height !== Math.round(height * dpr)) {
        element.width = Math.round(width * dpr)
        element.height = Math.round(height * dpr)
      }
      const { time, played, line } = clock.current
      drawHomeFilm(context, width, height, dpr, data.current, { time, played, line, still, floor: (foot.current?.offsetTop ?? height) - FLOOR_GAP })
    }
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const state = clock.current
      const passed = Math.min(0.1, (now - (state.last || now)) / 1000)
      state.last = now
      if (!state.paused) {
        state.time += passed
        state.played += passed
      }
      if (state.time >= HOME_LENGTH) {
        state.time -= HOME_LENGTH
        state.line += 1
      }
      setScene(homeScene(state.time))
      draw()
    }
    redraw.current = draw
    void files['../samples/home-film.json']().then((source) => {
      if (!alive) return
      data.current = buildHomeFilm(source)
      if (still) draw()
      else frame = requestAnimationFrame(tick)
    })
    const observer = new ResizeObserver(draw)
    observer.observe(element)
    if (foot.current) observer.observe(foot.current)
    return () => {
      alive = false
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [canvas, foot, still])

  /** Starts the film at a scene; with reduced motion, shows that scene's still. */
  const seek = useCallback((index: number) => {
    clock.current.time = still ? HOME_STILLS[index] : HOME_CUES[index]
    setScene(index)
    redraw.current()
  }, [still])

  const toggle = useCallback(() => {
    clock.current.paused = !clock.current.paused
    setPaused(clock.current.paused)
  }, [])

  return { scene, paused, still, seek, toggle }
}
