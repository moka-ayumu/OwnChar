import { cn } from '@/lib/utils';

/** Two or more options in one bordered row; the pressed one is solid ink. */
export function Segmented<T extends string>({ options, value, onChange, label, className }: { options: ReadonlyArray<readonly [T, string]>; value: T; onChange(value: T): void; label: string; className?: string }) {
	return (
		<div role="group" aria-label={label} className={cn('segmented', className)}>
			{options.map(([key, text]) => (
				<button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>
					{text}
				</button>
			))}
		</div>
	);
}
