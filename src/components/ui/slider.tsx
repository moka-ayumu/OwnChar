import * as SliderPrimitive from '@radix-ui/react-slider'
import type { ComponentProps } from 'react'

export function Slider(props: ComponentProps<typeof SliderPrimitive.Root>) {
  const { id, 'aria-label': ariaLabel, ...rootProps } = props
  return (
    <SliderPrimitive.Root className="relative flex h-5 w-full touch-none select-none items-center" {...rootProps}>
      <SliderPrimitive.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-[#E5E7EB]">
        <SliderPrimitive.Range className="absolute h-full bg-[#2457F5]" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb id={id} aria-label={ariaLabel} className="block size-4 rounded-full border-2 border-[#2457F5] bg-white outline-none focus-visible:ring-2 focus-visible:ring-[#2457F5]/30" />
    </SliderPrimitive.Root>
  )
}
