# AGENTS.md

OwnChar is a browser tool that turns handwriting into an OTF font. All processing runs in the browser. There is no server, no upload, and no account. Read `PRODUCT.md` for product purpose and screen rules, and `DESIGN.md` for visual rules. Read `docs/performance.md` before you change code on the write page, the project save path, or the learning code.

## Working Rules

- Push only when the user asks.
- UI copy is Korean, in polite 해요체. Example: "손글씨가 폰트가 되었어요." ("Your handwriting became a font.")
- Keep the product terms fixed: 수집 (collection), 문맥형 (contextual form), 고정 자모 (fixed jamo), 보정값 (adjustment value), 변경 적용 (apply changes).

## Tech Stack

Vite, React, TypeScript, TanStack Router, TanStack Store, Tailwind CSS, shadcn/ui, perfect-freehand, clipper2-ts, opentype.js, Vitest, Playwright.

## Folder Structure

```
src/
  font/         Stroke → outline → jamo layout → glyph. Pure logic
    stroke/     Hand-shake correction, stroke outlines
    geometry/   Path operations, shapes, collision checks, CFF outlines, optical correction
    layout/     Syllable layout, gap and proportion profiles, source selection
    glyphs/     Standalone jamo, digits and symbols, size correction
    hangul.ts   Jamo lists, syllable decomposition and composition, compound finals
    guides.ts   Fixed guide jamo in writing cells
  collection/   What the user writes: prompts, practice sentences, saved records
  generation/   Learns from handwriting and builds the font
    learning/   Learns gaps, proportions, and measures
    font-builder.ts, *.worker.ts   Font composition and workers
    otf-writer.ts   OTF file output
  project/      Project state and IndexedDB storage
  features/     Screen components (writing, editor, generating, preview, home)
    home/       The film on the home page: scenes, drawing, and its clock
    samples/    Example handwriting on the home page: strokes per sentence, the loader, and the data of the home film
  routes/       Routes: write, generate, preview, edit, license
  components/   Shared UI
  dev/          Dev-only sample button. Not a product screen
tests/
  unit/         Vitest. Pure logic
  e2e/          Playwright. Real browser flows
tools/          Node scripts for glyph checks. See tools/README.md. tools/out/ is not tracked
docs/           Design records and screen specs
```

Dependency direction: `font` ← `collection` ← `generation` ← `project` ← `features` ← `routes`. A lower layer never imports from a higher layer.

## Where to Change Things

| Change | Look first in |
|---|---|
| Position of initial, medial, and final inside a syllable | `src/font/layout/syllable-layout.ts`, `src/font/hangul.ts` |
| Gap between jamo | `src/font/layout/gap-profile.ts` |
| Size ratio between jamo | `src/font/layout/proportion-profile.ts` |
| Visual centring and optical correction | `src/font/geometry/optical.ts`, `src/font/geometry/shape.ts` |
| Collisions and overlaps | `src/font/geometry/collision.ts`, `src/font/layout/overlap-policy.ts` |
| Size dials (jamo size and syllable width toward the mean of the layout) | `docs/decision/0002-size-dials-on-the-preview.md` first, then the end of `layoutSyllable` in `src/font/layout/syllable-layout.ts`, `learnSizeTargets` in `src/font/layout/compose-syllable.ts` |
| Preview screen, live font of the typed text | `src/routes/preview.tsx`, `src/features/preview/`, `src/generation/use-live-font.ts`, `src/generation/live-font.worker.ts` |
| Learning values from handwriting | `src/generation/learning/` |
| Writing screen and stroke input | `src/features/writing/` |
| Edit screen | `src/features/editor/` |
| Saving and autosave | `src/project/` |
| Switching sentence, drawing latency, save stalls | `docs/performance.md` first, then `src/features/writing/`, `src/generation/use-composition-context.ts`, `src/project/persistence.ts` |

## Performance

`docs/performance.md` records the causes, the rules, and the measuring method. Follow it when you change code or add a feature.

- Targets: a sentence switch in 16 ms or less, a pointer move in 5 ms or less, no stall over 20 ms after a stroke or an autosave.
- Do not change state objects in place. Caches key on object identity. A saved record that did not change must stay the same object (`keepIfSame`).
- Do not put work on the path that runs on every pointer move (`onChange` of `WritingSurface`, `save` in `use-writing-session.ts`) or on the save path (`saveSentenceCapture`) without measuring it.
- Pass `memo` components strings, flags, and stable callbacks (`useStableCallback`). Do not pass values that change on every move.
- Do not share a cached shape between prompts. Copy its centerlines (`normalizedSource`).
- Run slow work in steps with `src/lib/idle.ts`. A task that runs in steps must keep its progress.
- The project is saved as records. When you add state, check that the save diff still writes only what changed.
- Measure before and after with the same method (see the measuring section of the document). Keep a change only if the number improves. If the font output can change, compare the hash of `tools/verify/golden.mjs`.
- After a change in this area, update `docs/performance.md`: the table of causes, the rules, the measured values, and the list of rejected tries.

## Files Not in Git

- `src/dev/sample-project.json`: sample project with user data. The dev sample button and the verification scripts read it. If it is missing, ask the user for it. The app works without it.

## Checks

- Type check: the `typecheck` script.
- Unit tests: run the `test` script for the related file only, for example `tests/unit/layout.test.ts`.
- Lint: the `lint` script, only after large code changes.
- Browser flow tests: the `test:e2e` script, only when a screen flow or the save format changes.

Keep tests to a minimum. For glyph changes, use the check in "Verifying Glyph Changes" instead of adding tests.

## Verifying Glyph Changes

When you add or change a feature that affects glyphs, follow these steps.

1. Pick at least 6 representative glyphs. Cover every role you changed (initial, medial, final). The default candidates are the list in `tools/lib/glyphs.mjs`: 괌 낡 넘 뢒 뢥 꽈 깲 뇲 줬 계 뭐 가 고 구 그 각 곡 굵 읽 닭
2. Use `src/dev/sample-project.json` as the test project. Compare before and after changes on the same glyphs.
3. As `tools/verify/golden.mjs` does, load `src/generation/font-builder.ts` through a Vite server to build the real composition. Do not use fake values for the screen.
4. Write the result as one SVG sheet at `tools/out/<name>.svg`. Use the sheet format in `tools/verify/render-review.mjs` as a reference. Put the before and after versions side by side in each cell.
5. Convert the SVG to PNG:

```bash
node tools/verify/snap.mjs <name>.svg 1400
```

6. Show `tools/out/<name>.png` to the user. Give the file path in the final answer.
7. In the final answer, write one line per glyph. State whether the problem is solved, and what problem remains.

NOTE: If the image shows a problem, fix the rule that causes it. Do not add an exception value for one glyph.

## Prohibited

- Do not add exception values or hard-coded tables for a single glyph.
- Do not modify `src/dev/sample-project.json`. It contains user data.
