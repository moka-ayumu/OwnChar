---
version: 1
slug: "src-routes-generate-tsx"
primary_target: "src/routes/generate.tsx"
related_targets: ["src/features/writing/write-page.tsx","src/routes/preview.tsx"]
---

# Write → Generate → Preview flow

Mode: Operate. Scope: `/write`, `/generate`, `/preview` as one continuous sequence; the rest of the product inherits its world.

Audience and job: a first-time, non-designer writer at a tablet or desktop turning 12 sentences of handwriting into an OTF. Task: write, start generation, see how the strokes become a font, then test and download it.

Confirmed constraints (user, 2026-10-04):
- Avoid paper/stationery imitation, the common SaaS/AI-tool look, and a dark technical look.
- Few colours, simple, motion-graphic.
- First generation plays the full algorithm sequence (about 8–10 s minimum, with a skip control). Regeneration through 변경 적용 plays a short version (about 3 s).
- Generation must show the real stages on the user's own strokes; preview opens with the sample sentence typing itself.

## Direction contract

THESIS: One stroke, never cut. The same handwriting stays on screen from the writing cell to the finished font, changing pose at each algorithm instead of being replaced by a loading screen. Refused: the spinner-and-progress-bar interstitial and the white/blue tool shell.

OWN-WORLD: Three values: ink `#101114`, white, lime `#C6F432`, on a quiet neutral ground `#ECEDE8`; one functional red `#C2261A` for destructive and error states only. Flat fields, no shadows, no gradients. Selection, the live step, progress and primary actions are solid ink. Lime is the field colour of whatever frames the work (the flow rail, the editor bar, the home demonstration) and the mark of the live jamo inside the film; it is never a text colour on white. One sans family (Wanted Sans); hierarchy by weight and ink/lime reversal, few sizes. 6px corners. 1px ink hairlines.

STORY: The writer sees their own letter lifted from the sentence, steadied, outlined, split into jamo, normalised, recombined into other syllables, multiplied to 11,172, and then typed back to them as a sentence in their font.

FIRST VIEWPORT: Write: lime rail (280px) at left with collection count in large tabular numerals and the 12 sentences; white writing canvas fills the rest under a single tool strip; the step action is solid ink at the rail bottom. Generate: one white stage, specimen syllable in a fixed box at the centre, step ticker with a one-line explanation of the live algorithm in the rail, progress and cancel at the rail bottom. Preview: typed sentence leads the stage; download is solid ink at the rail bottom, the same place the primary action holds on the other two pages (moved from top right after the build, so the primary action never changes position across the flow).

FORM: Sequential-pose pictogram graphics; candidate 7 of the third hand; seed key e42abda1 (reroll 2). Signature interaction: the stage is a shared element across the three routes; strokes morph pose in place and the lead glyph becomes the first typed character.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Unresolved: none.
