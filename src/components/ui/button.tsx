import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-[background-color,color,border-color,transform] duration-150 active:scale-[.97] disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default: 'bg-ink text-white hover:bg-[#2c2e34]',
        secondary: 'border border-ink/25 bg-transparent text-ink hover:border-ink/50 hover:bg-ink/8',
        ghost: 'bg-transparent text-ink hover:bg-ink/8',
        lime: 'bg-lime text-ink hover:bg-lime-deep',
        inverse: 'border border-white/60 bg-transparent text-white hover:bg-white/12',
        destructive: 'border border-danger bg-transparent text-danger hover:bg-danger hover:text-white',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 px-3',
        lg: 'h-12 px-5 text-base',
        icon: 'size-9 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { buttonVariants }
