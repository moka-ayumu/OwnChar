import type { CharacterPrompt } from '@/collection/prompts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

export type GenerationDialog = 'missing' | 'conflict' | null

/** What to confirm before generating: characters still missing, then manual glyph edits a rewrite may invalidate. */
export function GenerationDialogs({ dialog, missing, modifiedGlyphCount, onClose, onProceed, onKeepEdits, onDiscardEdits }: {
  dialog: GenerationDialog
  missing: CharacterPrompt[]
  modifiedGlyphCount: number
  onClose(): void
  onProceed(): void
  onKeepEdits(): void
  onDiscardEdits(): void
}) {
  const variants = missing.filter((item) => item.variantRole)
  const symbols = missing.filter((item) => item.group === 'symbol')
  const base = missing.filter((item) => !item.variantRole && item.group !== 'symbol')
  return (
    <>
      <Dialog open={dialog === 'missing'} onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogTitle>수집되지 않은 글자가 있습니다</DialogTitle>
          <DialogDescription>기본 글자 {base.length}개, 문맥형 {variants.length}개, 기호 {symbols.length}개가 비어 있습니다. 빠진 기호와 기본 글자는 폰트에서 제외되고, 문맥형은 다른 문맥의 같은 자모로 대체됩니다.</DialogDescription>
          <div className="mt-4 max-h-24 overflow-y-auto rounded-md bg-ground p-3 text-sm leading-6 text-ink-2">{missing.map((item) => item.char).join(' ')}</div>
          <div className="mt-6 flex justify-end gap-2">
            <DialogClose asChild><Button variant="secondary">계속 작성하기</Button></DialogClose>
            <Button onClick={onProceed}>그래도 생성하기</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === 'conflict'} onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogTitle>기존 글리프 보정을 어떻게 하시겠습니까?</DialogTitle>
          <DialogDescription>고급 편집에서 수정한 {modifiedGlyphCount.toLocaleString()}개 글리프의 보정값이 달라질 수 있습니다.</DialogDescription>
          <div className="mt-6 grid gap-2">
            <Button onClick={onKeepEdits}>보정 유지하고 재합성</Button>
            <Button variant="destructive" onClick={onDiscardEdits}>기존 보정 삭제 후 재합성</Button>
            <DialogClose asChild><Button variant="ghost">취소</Button></DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
