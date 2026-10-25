import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuSeparator = (props: ComponentProps<typeof MenuPrimitive.Separator>) => <MenuPrimitive.Separator className="menu-separator" {...props} />;

export function DropdownMenuContent({ className, ...props }: ComponentProps<typeof MenuPrimitive.Content>) {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Content align="end" sideOffset={6} collisionPadding={12} className={cn('menu', className)} {...props} />
		</MenuPrimitive.Portal>
	);
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof MenuPrimitive.Item>) {
	return <MenuPrimitive.Item className={cn('menu-item', className)} {...props} />;
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
	return <MenuPrimitive.Label className={cn('menu-label', className)} {...props} />;
}
