import { Button } from '@/components/ui/button'

/**
 * A row above the size dials for a writer who has drawn no glyph whole: two ㅋ close up into one
 * dashed cell, and a pen draws the glyph that takes their place.
 */
export function CustomIntro({ fontFamily, onGuide, onTry }: {
  fontFamily: string
  onGuide(): void
  onTry(): void
}) {
  return (
    <section className="custom-intro" aria-label="직접 쓴 글자">
      <div className="custom-intro-demo" aria-hidden="true">
        <span className="custom-intro-pair" style={{ fontFamily }}><i>ㅋ</i><i>ㅋ</i></span>
        <svg viewBox="0 0 64 40" className="custom-intro-cell">
          <rect x="1" y="1" width="62" height="38" rx="4" />
          <path d="M16 12 H27 L25 28 M37 12 H48 L46 28" pathLength="1" />
        </svg>
      </div>
      <div className="custom-intro-text">
        <strong>직접 쓴 글자</strong>
        <span>대체 · 추가 · 합자</span>
      </div>
      <div className="custom-intro-actions">
        <Button size="sm" variant="secondary" onClick={onGuide}>사용 안내</Button>
        <Button size="sm" onClick={onTry}>써 보기</Button>
      </div>
    </section>
  )
}
