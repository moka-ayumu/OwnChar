import * as SliderPrimitive from '@radix-ui/react-slider'
import type { ComponentProps } from 'react'

export function Slider(props: ComponentProps<typeof SliderPrimitive.Root>) {
  const { id, 'aria-label': ariaLabel, ...rootProps } = props
  return (
    <SliderPrimitive.Root className="relative flex h-5 w-full touch-none select-none items-center data-[disabled]:opacity-40" {...rootProps}>
      <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-ink/18">
        <SliderPrimitive.Range className="absolute h-full bg-ink" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb id={id} aria-label={ariaLabel} className="block size-4 rounded-full bg-ink outline-none ring-white transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" />
    </SliderPrimitive.Root>
  )
}
