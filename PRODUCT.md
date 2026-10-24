# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who want a font in their own handwriting and write with a pen, mouse, or touch. No account or login exists. They use a tablet or desktop; phone-sized screens get only a "더 넓은 화면이 필요해요" notice. The UI and all copy are Korean. Some will be non-designers making a font for the first time, so nothing may assume font-tooling knowledge.

## Product Purpose

OwnChar turns handwriting into an installable OTF font, entirely in the browser. The user writes 8 practice sentences (5 Hangul, uppercase, lowercase, digits and symbols) in per-character cells. The system splits strokes into jamo (초성/중성/종성), collects them, and composes all 11,172 modern Hangul syllables plus Latin, digits and symbols. Success is a downloaded `.otf` that looks like the user's own writing and has balanced composition.

## Positioning

A handwriting font for Hangul built from a few sentences, not 11,172 hand-drawn glyphs. Jamo are collected and recombined by context-aware composition (초성 8 variants, 중성 2, 종성 1). Everything runs in the browser.

## Operating Context

Flow: Home `/` → Write `/write` → Generate `/generate` → Preview `/preview` (download OTF) → optional Edit `/edit` (per-glyph adjustment and composition settings) → "변경 적용" regenerates. Help lives at `/license`. A common header has a logo (home), 도움말, and GitHub link.

State is autosaved to IndexedDB (strokes, jamo, settings, generated font, last sentence); the collected-jamo view mode is saved with the project. Generation runs in background workers. Private browsing may disable storage; the app then works in memory and loses work on refresh. A "변경됨" marker shows when the font is out of date versus the handwriting or settings.

## Capabilities and Constraints

- Pen pressure maps to stroke width; stroke width 1–5, hand-shake correction 0–1, cell size 112–184 px (locked once strokes exist).
- Strokes belong to the cell where they started. Wrongly split jamo can be fixed by setting boundaries manually. Eraser, undo/redo (50 steps), clear sentence.
- Each project shows collected jamo in one of three ways, set in the writing settings: blank cells (the default; every cell is written in full, and of the jamo written more than once the best drawing is used), collected jamo fixed as gray guides, or fixed jamo with dashed boxes for the slots still to be written. Derived collection fills standalone consonants and vowels. Double final consonants are synthesized, not required.
- Generation is allowed with missing items: missing symbols and base letters are omitted, missing context variants fall back to other contexts of the same jamo. Conflicts with manual glyph adjustments require an explicit keep/discard/cancel choice.
- Preview: free text in the user's font, size 36–160 px, font name/author/version, `폰트이름.otf` download.
- Custom glyphs (advanced edit, "직접 쓴 글자"): the user types one to four characters and draws them whole. One character the font already makes is fixed over its composed glyph (대체), one it lacks is added (추가), and two to four become an OpenType `liga` ligature (합자). A three-step guide opens once on the first preview. See `docs/decision/0009-custom-glyphs-and-ligatures.md`.
- Advanced edit: per-glyph margins, height, scale, rotation; multi-select; global margins; 10 composition settings with instant preview cards; restore defaults.
- Terminology to keep: 수집, 문맥형, 고정 자모, 보정값, 변경 적용.
- Spec scope is function and controls only; visual design is undefined in the docs.

## Brand Commitments

Name: OwnChar. Default font name "OwnChar Font". UI voice is plain, concise Korean in a formal register (합쇼체 or noun endings), not friendly or chatty, e.g. "폰트 생성이 완료되었습니다."

## Evidence on Hand

Use-case and page specs in `docs/use-cases` (UC-01–10, PG-01–08). Open-source library credits shown on the help page. No testimonials, user counts, or sample fonts exist; do not fabricate them. The home page offers one example handwriting ("예시 손글씨", `src/features/samples/example.json`). A program made its strokes; call it an example, never a person's handwriting.

## Product Principles

1. **Writing comes first.** The writing surface is the hero; everything else supports getting strokes in without friction.
2. **Never lose work.** Autosave is invisible, and destructive actions (restart, discard adjustments) always confirm.
3. **Incomplete is allowed.** Users can generate before collecting everything. Always state what will be omitted or substituted.
4. **Make the invisible legible.** Progress, collection counts, and "변경됨" state show what the system is doing and what is out of date.
5. **No explanatory filler.** If a control is understood without a sentence, show no sentence. Explanation that is needed goes in a tooltip (`Hint`), never as standing text on the page.

## Accessibility & Inclusion

No product-specific standard has been established. Input is pen, mouse, and touch. Keyboard shortcuts are documented only for glyph multi-select (Shift, Ctrl/⌘).
