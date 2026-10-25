import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

interface SwitchProps extends Omit<ComponentProps<'button'>, 'onClick' | 'role' | 'type'> {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}

/** A two-state control: the track darkens and the lime thumb moves to the right when on. */
export function Switch({ checked, onCheckedChange, className, ...props }: SwitchProps) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={() => onCheckedChange(!checked)}
			className={cn('group relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-ink/18 transition-colors aria-checked:bg-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink', className)}
			{...props}
		>
			<span className="pointer-events-none block size-[18px] translate-x-[3px] rounded-full bg-white shadow-sm transition-[transform,background-color] group-aria-checked:translate-x-[23px] group-aria-checked:bg-lime" />
		</button>
	);
}
