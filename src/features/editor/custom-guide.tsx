import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { customKind, CUSTOM_KIND_LABELS, RECOMMENDED_CUSTOM } from '@/collection/custom-glyphs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { projectActions } from '@/project/store';

const WAYS = [
	{ text: '안', note: '자동 조합된 글자를 직접 쓴 글자로 고정합니다.' },
	{ text: '♡', note: '폰트에 없는 글자를 직접 써서 추가합니다.' },
	{ text: 'ㅋㅋ', note: '글자열이 입력되면 직접 쓴 한 글자로 바꿉니다.' }
] as const;

const ORDER = [
	['글자 입력', '고급 편집의 직접 쓴 글자에서 글자를 입력하고 추가합니다.'],
	['칸에 쓰기', '칸에 글자를 씁니다. 저장은 자동으로 됩니다.'],
	['변경 적용', '변경 적용 후 OTF에 반영됩니다.']
] as const;

const STEPS = ['세 가지 방식', '쓰는 순서', '추천 예시'];

/**
 * The guide to glyphs drawn whole, in three steps; the last offers a few to write at once.
 * Closing it, however it is closed, counts as seen.
 */
export function CustomGuide({ open, fontFamily, onOpenChange, onPick }: { open: boolean; fontFamily: string; onOpenChange(open: boolean): void; onPick(text: string): void }) {
	const change = (next: boolean) => {
		if (!next) projectActions.markCustomGuideSeen();
		onOpenChange(next);
	};
	const pick = (text: string) => {
		projectActions.markCustomGuideSeen();
		onOpenChange(false);
		onPick(text);
	};

	return (
		<Dialog open={open} onOpenChange={change}>
			<DialogContent className="guide-dialog">
				<GuideSteps fontFamily={fontFamily} onPick={pick} />
			</DialogContent>
		</Dialog>
	);
}

/** The steps. The dialog drops its contents when it closes, so each opening starts at the first step. */
function GuideSteps({ fontFamily, onPick: pick }: { fontFamily: string; onPick(text: string): void }) {
	const [step, setStep] = useState(0);
	const last = step === STEPS.length - 1;

	return (
		<>
			<DialogTitle>{STEPS[step]}</DialogTitle>
			<DialogDescription className="sr-only">
				직접 쓴 글자 사용 안내 {step + 1} / {STEPS.length}
			</DialogDescription>

			<div className="guide-body">
				{step === 0 && (
					<ul className="guide-ways">
						{WAYS.map((way) => (
							<li key={way.text}>
								<span className="guide-sample" style={{ fontFamily }}>
									{way.text}
								</span>
								<div>
									<span className="custom-tag">{CUSTOM_KIND_LABELS[customKind(way.text)]}</span>
									<p>{way.note}</p>
								</div>
							</li>
						))}
					</ul>
				)}
				{step === 1 && (
					<ol className="guide-order">
						{ORDER.map(([title, note], index) => (
							<li key={title}>
								<span className="guide-number tnum">{index + 1}</span>
								<div>
									<strong>{title}</strong>
									<p>{note}</p>
								</div>
							</li>
						))}
					</ol>
				)}
				{step === 2 && (
					<div className="custom-suggest">
						{RECOMMENDED_CUSTOM.map((text) => (
							<button key={text} type="button" onClick={() => pick(text)}>
								<span style={{ fontFamily }}>{text}</span>
								<small>{CUSTOM_KIND_LABELS[customKind(text)]}</small>
							</button>
						))}
					</div>
				)}
			</div>

			<div className="mt-6 flex items-center justify-between gap-2">
				<span className="tnum text-xs font-semibold text-ink-2">
					{step + 1} / {STEPS.length}
				</span>
				<div className="flex gap-2">
					{step > 0 && (
						<Button variant="secondary" onClick={() => setStep(step - 1)}>
							이전
						</Button>
					)}
					{last ? (
						<Button onClick={() => pick(RECOMMENDED_CUSTOM[0])}>
							{RECOMMENDED_CUSTOM[0]} 써 보기 <ArrowRight className="size-4" />
						</Button>
					) : (
						<Button onClick={() => setStep(step + 1)}>다음</Button>
					)}
				</div>
			</div>
		</>
	);
}
