---
name: OwnChar
description: 손글씨가 폰트가 되는 과정을 한 번도 끊지 않고 보여주는, 잉크·흰색·라임 한 면의 연속 동작 시스템
colors:
  ink: "#101114"
  ink-hover: "#2c2e34"
  ink-2: "#4a4c52"
  ink-3: "#666970"
  rule: "#d9dad5"
  ground: "#ecede8"
  white: "#ffffff"
  lime: "#c6f432"
  lime-deep: "#b2e016"
  lime-ink: "#3c4a0a"
  danger: "#c2261a"
typography:
  display:
    fontFamily: "Wanted Sans Variable, Wanted Sans, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, Segoe UI, sans-serif"
    fontSize: "clamp(34px, 4vw, 52px)"
    fontWeight: 800
    lineHeight: 1.16
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Wanted Sans Variable, Wanted Sans, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, Segoe UI, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  figure:
    fontFamily: "Wanted Sans Variable, Wanted Sans, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, Segoe UI, sans-serif"
    fontSize: "44px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  title:
    fontFamily: "Wanted Sans Variable, Wanted Sans, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, Segoe UI, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.55
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Wanted Sans Variable, Wanted Sans, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "normal"
  ui:
    fontFamily: "Wanted Sans Variable, Wanted Sans, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.43
    letterSpacing: "normal"
  label:
    fontFamily: "Wanted Sans Variable, Wanted Sans, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.6
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "6px"
  full: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  header: "56px"
  rail: "280px"
  rail-compact: "244px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
    textColor: "{colors.white}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  button-lime:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  button-lime-hover:
    backgroundColor: "{colors.lime-deep}"
    textColor: "{colors.ink}"
  button-inverse:
    backgroundColor: "transparent"
    textColor: "{colors.white}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  button-destructive:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  button-destructive-hover:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.white}"
  text-input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 11px"
    height: "38px"
  rail:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    padding: "24px 22px 20px"
    width: "{spacing.rail}"
  stage:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
  rail-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "8px"
  rail-row-current:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "8px"
  segmented-option-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    typography: "{typography.ui}"
    rounded: "{rounded.sm}"
    padding: "7px 16px"
  dialog:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "24px"
    width: "448px"
  ink-bar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "11px 12px 11px 14px"
---

# Design System: OwnChar

## Overview

**Creative North Star: "연속 동작 (One Stroke, Never Cut)"**

OwnChar draws like a sequential-pose pictogram: one subject, shown again and again in a new pose, never swapped for something else. The subject is the writer's own handwriting. It is written on a white stage, and from that point on it stays on screen: lifted out of its sentence, steadied, outlined, split into jamo, brought to one size, recombined, multiplied to 11,172 syllables, and finally typed back as a sentence. No page in the flow replaces the handwriting with a spinner or an illustration of progress; the handwriting is the progress.

The palette is three values on a quiet ground: ink, white, and one lime field. Everything is flat. Lime is a surface that frames the work (the flow rail, the editor bar, the home demonstration); white is where the work happens; solid ink marks whatever is selected, live, or primary. Hierarchy comes from weight and from reversing ink and lime, not from more colours or more sizes. Corners are 6px, lines are 1px.

The system is dense and tool-like in the stage and calm in the rail. It avoids paper or stationery imitation, the white-and-blue SaaS tool shell, and a dark technical look; those were ruled out by the user when this world was chosen.

**Key Characteristics:**
- Ink, white, one lime field, on a warm-neutral ground; one red for destruction and errors only.
- A fixed frame for the main flow: lime rail at the left, white stage for the rest, primary action at the rail's bottom.
- Solid ink is the single mark of "selected / current / primary".
- Flat: no elevation shadows, no tonal gradients, 1px hairlines, 6px corners.
- One sans family (Wanted Sans); the user's handwriting font is the only other typeface that ever appears.
- Motion keeps things in place and changes their pose; route changes hold the rail and stage and move one glyph across.

## Colors

Three working values (ink, white, lime) on a neutral ground, with greys only for secondary text and hairlines, and a single functional red.

### Primary
- **Ink** (`ink`, #101114): text, 1px structural lines, and every solid mark of state: primary buttons, the current row in a rail list, the pressed segment, the selected glyph cell, progress and slider fill, the focus outline, the user's strokes. On hover a solid ink button lifts to **Ink Hover** (`ink-hover`, #2c2e34).

### Secondary
- **Lime Field** (`lime`, #c6f432): the colour of the surface that frames the work. Full-bleed on the flow rail, the editor top bar, the home demonstration half, and the phone-size notice. Smaller uses are all "this is live": text selection, the source-cell highlight on the writing grid (40% tint), the wash of a finished cell (24% tint) and a done jamo in the cell popover (40% tint), the dashed placeholder for a jamo not yet written (22% tint), a source link on hover, the film's live jamo zone, raw-trace line, outline fill, worker fronts and finish box, and the action button on an ink bar.
- **Lime Deep** (`lime-deep`, #b2e016): hover state of a lime button only.
- **Lime Ink** (`lime-ink`, #3c4a0a): secondary text on lime (labels, notes, counts, steps not yet reached, the rail list's scrollbar). 7.5:1 on lime.

### Tertiary
- **Functional Red** (`danger`, #c2261a): the destructive button, the error panel's border and heading, and the boundary warning. Nothing else.

### Neutral
- **White** (`white`, #ffffff): the stage, the writing canvas, inputs, cards, dialogs, the specimen tile on lime. Text on solid ink.
- **Ground** (`ground`, #ecede8): the page behind everything: header, home copy column, the editor's glyph preview well, an inset list inside a dialog, glyph-cell hover.
- **Rule** (`rule`, #d9dad5): quiet hairlines inside white: writing-grid cell lines, input and card borders at rest, sample-row dividers, toolbar dividers, the film's specimen boxes, trail tiles and unfilled lanes.
- **Ink 2** (`ink-2`, #4a4c52): secondary text on white and ground (descriptions, field labels).
- **Ink 3** (`ink-3`, #666970): tertiary text: placeholders, captions, cell characters in the writing grid. 5.5:1 on white, 4.7:1 on ground.

Translucent ink is used for three things only: hover wash on transparent controls (8%, 9% on rail rows), unfilled track (15% progress, 18% slider), and the dialog scrim (45%).

### Named Rules
**The Solid Ink Rule.** Selection, the live step, progress, and the primary action are solid ink with white text. If two things on one surface are solid ink, one of them is wrong, unless one is a toggle that is on.

**The Lime Is A Field Rule.** Lime is a surface or a tint, never a text colour on white or ground (1.3:1). Lime text exists only on solid ink: the number of the current step, the count in the current rail row, the dot in the logo mark.

**The One Red Rule.** Red means "this destroys work" or "this failed". It is never decoration, never a badge, never a second accent.

## Typography

**Display Font:** Wanted Sans Variable (with Wanted Sans, -apple-system, Apple SD Gothic Neo, Malgun Gothic, Segoe UI, sans-serif)
**Body Font:** the same family
**Specimen Font:** the user's generated font (`OwnCharPreview`), only for their own text: the preview sentence, sample rows, glyph cells.

**Character:** One heavy, tight Korean grotesque doing everything by weight. Headings are 800 and tightly tracked; the interface underneath is 14px at 600. The only expressive letterforms on screen are the writer's own.

### Hierarchy
- **Display** (800, clamp(34px, 4vw, 52px), 1.16, -0.035em): the home headline, max 15em wide. The help page title sits at this role's floor (34px, -0.03em).
- **Headline** (800, 26px, 1.25, -0.03em): the one heading of a rail or a workspace. The sentence being written uses the same size at 700 / 1.3, because it is content to copy, not a title.
- **Figure** (800, 44px, 1, -0.03em, tabular): the single big number in a rail (collected count, percent), with its unit at 14px / 600 in lime-ink.
- **Title** (700, 18px, -0.02em): dialog titles and section headings on the help page. Panel headings inside the editor drop to 14px / 600–700.
- **Body** (400, 16px, 28px line): prose on ground or white, in ink-2, max 34em on home and 68ch on help. Dense descriptions use 14px with a 24px line.
- **UI** (600, 14px): buttons, rail rows, navigation (500), inputs (400).
- **Label** (600, 12px, 1.6 for notes): field labels, rail labels and notes, counts, captions. 12px is the floor.

### Named Rules
**The Few Sizes Rule.** 12, 14, 16, 18, 26, 44 and the display clamp. A new level of hierarchy is a weight change or an ink/lime reversal before it is a new size.

**The Tabular Rule.** Every number that changes (counts, percent, px values, slider readouts) is tabular and non-wrapping.

**The Korean Line Rule.** Text breaks between words, not inside them (`word-break: keep-all`), and headings are balanced.

## Layout

**Shell.** A 56px header on ground with a 1px ink bottom line: logo at left (26px ink square with a 10px lime dot, wordmark 16px / 800), two quiet links at right. Everything below fills `100svh − 56px` and does not scroll as a page; panels scroll inside themselves with thin scrollbars. The three flow pages (write, generate, preview) run without the header: their rail opens with the logo instead, and the stage takes the full height. On generate and preview the logo leads home and the two links sit at its right; on write the mark opens and closes the rail, the wordmark beside it leads home, and the links sit at the right end of the sentence row.

**The rail-and-stage frame.** Write, Generate and Preview share one grid: a lime rail (280px; 244px at ≤1100px; on write 232px, 216px at ≤1100px, closing to a 56px column of icons) with a 1px ink right edge, and a white stage taking the rest. The rail is a column with padding 24 / 22 / 20: at the top, what this step is (a headline with a one-line note, or a figure with its label); in the middle, the step's list or fields; at the bottom, pushed down by auto margin, the actions. The primary action is solid ink at the rail's bottom on all three pages, so it never changes position through the flow. The stage holds only the work: the writing canvas beside its 56px tool rail, the film, or the typed sentence.

**Other pages inherit the same parts in a different arrangement.** Home is two columns (1.05fr / 0.95fr): copy on ground, demonstration on a lime half with an ink left edge. The editor is a 56px lime bar over white panels divided by 1px ink lines (glyph browser / preview well on ground / 280px settings; or examples / 340px controls). Help is a single 68ch column on ground with sections opened by a 1px ink top line.

**Spacing.** An 8px-rooted rhythm: 8 between buttons and rows, 12 between toolbar groups, 16 between cards and fields, 24 inside panels, 28–32 around the stage content, 40–56 around the home columns.

**Responsive.** At ≤1100px the rail narrows to 244px, toolbar dividers drop, the editor loses its preview well and the example grid goes from three columns to two. At ≤767px the app is replaced by a lime full-height notice ("더 넓은 화면이 필요해요"); writing needs a tablet or desktop. Minimum width is 320px.

**Route motion.** Navigations inside the flow use view transitions with two named parts:
- `rail`: the lime field holds still (the group is painted lime for 420ms); the old contents leave upward 8px over 150ms ease-in, then the new rise 10px into place over 320ms.
- `stage`: the white field holds still for 420ms; its contents cross-fade.
- The first sentence of the preview does not travel: generation ends with it standing exactly where the preview shows it, so the stage cross-fade leaves it still.
- Everything else cross-fades in 200ms.

All of it eases with one curve, `cubic-bezier(.16, 1, .3, 1)`. Entrances are short and one-directional (360–520ms, a rise of 8–14px or a scale from .86–.94); nothing bounces or loops except the typing caret.

**Reduced motion.** With `prefers-reduced-motion`, all transitions and animations collapse to instant and view transitions are disabled. The generation film is not played: the stage shows only the worker lanes filling from real progress, with no skip control, no trail and no hand-over. The home demonstration stops cycling.

### Named Rules
**The Same Place Rule.** A page in the write → generate → preview flow uses the rail-and-stage frame, puts its primary action at the rail's bottom, and names its rail `rail` and its stage `stage` so the frame holds across the navigation.

**The Never Cut Rule.** Waiting is shown on the user's own strokes, driven by real progress. No spinner, no skeleton, no stand-in illustration.

## Elevation & Depth

Flat. There is no elevation: no drop shadows, no blur, no glass. Layers are told apart by field colour (ground → white → lime → ink) and by 1px lines. A dialog sits on a 45% ink scrim with a 1px ink border; the cell popover and the writing settings are white with a 1px ink border, laid over the canvas; none casts a shadow.

`box-shadow` appears only as a zero-blur line: the 2px ink ring on a focused text input, and a 1px inset outline on an empty tile. `linear-gradient` appears only to draw the half-pixel centre guides of a writing cell. Neither is ever used for tone or lift.

### Named Rules
**The Flat Field Rule.** Depth is a change of field or a hairline. If a surface needs a shadow to read as separate, give it a border in ink or rule instead.

## Shapes

One corner: 6px on every control and container (buttons, inputs, rows, cards, dialogs, the canvas frame, tiles). Nested controls step down to 4px (the options inside the segmented control). Full rounding is reserved for things that are tracks or points: progress and slider tracks, the slider thumb, the logo dot, the "modified" dot on a glyph cell. Inside the film, boxes are square-cornered and drawn on half-pixels: they are measurements, not controls.

Lines carry meaning by weight and dash:
- 1px ink: structure (rail and header edges, panel dividers, the canvas frame, dialog border, secondary buttons, inputs on lime).
- 1px rule: quiet division inside white.
- 2px ink, 2px offset: keyboard focus, everywhere.
- 3px ink inset: the one cell a glyph's source link points at.
- Dashed: provisional or not-yet. The placeholder for an unwritten jamo (4 3), the final-consonant zone in the film (4 3), the band guide (1 4).

Icons are 1.5–2px line icons (Lucide) at 14–16px, always beside a text label unless the control is an icon button with an aria-label; completed rows use a 14px check at stroke 3.

## Components

### Buttons
Compact, square-shouldered, weight 600. Height 40px with 16px side padding (32px / 12px small, 48px / 20px / 16px text large, 36px square for icons); 8px between icon and label.
- **Primary:** solid ink, white text; hover lifts to ink-hover. One per surface, at the rail's bottom in the flow.
- **Secondary:** transparent with a 1px ink border; hover is an 8% ink wash. The alternative next to a primary.
- **Ghost:** no border; same hover wash. Toolbar tools, cancel, back links. A tool that is on switches to the primary style (`aria-pressed`).
- **Lime:** lime with ink text, hover lime-deep. Only on a solid ink surface (the "변경됨" banner), where ink cannot be the mark.
- **Inverse:** transparent, 1px white border at 60%, white text; the secondary on an ink surface.
- **Destructive:** 1px red border and red text; fills red with white text on hover.
- **States:** pressing scales to .97; disabled is 40% opacity with no pointer events; transitions are 150ms on colour, border and transform.

### Inputs / Fields
- **Text input:** 38px high, white, 1px rule border, 6px corner, 14px text, 11px side padding. Hover darkens the border to ink-3; focus turns it ink with a 2px ink ring. On lime the border is ink at rest.
- **Label:** 12px / 600 above the field with 6px between, ink-2 on white and lime-ink on lime.
- **Slider:** 4px track in 18% ink, ink range, 16px round ink thumb that grows to 1.1 on hover; disabled 40%. Always paired with a tabular readout.
- **Progress:** 6px rounded track in 15% ink with a solid ink fill, 200ms.

### Rail rows (sentence list, step list)
A row with a 23px leading column, then the name at 14px / 600. In the step list the column holds the number (12px / 700, tabular) or a 14px check when done. In the sentence list it holds a progress ring (18px, 3px stroke: a 20% track and an ink arc filling clockwise) that becomes a check when the sentence is fully collected; the count ("43 / 44 자모") shows as a hint on hover or focus. 6px corner, 8px padding, bleeding 8px past the rail's text edge so the current row's ink block aligns with the text. With the write rail closed only the ring column remains, in the same place.
- **Rest:** ink text (steps not yet reached: lime-ink).
- **Hover (when clickable):** 9% ink wash.
- **Current:** solid ink, white text, the number, ring arc or check in lime; `aria-current="step"`.

### Segmented control
Two or more options inside a 1px ink border with 2px padding and a 6px corner; each option is 14px / 600 with 7px / 16px padding and a 4px corner. The pressed option is solid ink with white text. Centred in the editor bar.

### Dialogs
White, 1px ink border, 6px corner, 24px padding, max 448px, centred on a 45% ink scrim; a ghost close button at top right. Title 18px / 700, description 14px with a 24px line in ink-2, an optional inset list on ground. Actions sit at the bottom right (secondary, then primary), or stacked full-width when there are three choices (primary, destructive, ghost cancel). A destructive choice is confirmed in one.

### Ink bar
A solid ink strip with white text for a state that needs an answer now: the "변경됨" banner at the top of the preview stage, with a small lime "변경 적용" button.

### Writing canvas
The hero surface, and everything to the right of the tool rail. Under the sentence row (the sentence alone at 26px / 700; at its right end a 22px progress ring for this sentence and the help and GitHub links; closed by a 1px ink line) the grid runs edge to edge: square cells (112–184px) divided by rule lines with faint centre guides (6% ink) and the target character at 12px in the cell's bottom-right corner. As many columns as fit; the grid is centred and only it scrolls. Strokes are solid ink; an unwritten jamo's slot is a dashed, lime-tinted box; the cursor is a crosshair.

- **Finished cell:** a 24% lime wash, 240ms. A cell is finished when every jamo it collects is done; a cell that collects nothing (a space, a jamo fixed elsewhere) is finished once a later cell has a stroke. Cells still to write stay white.
- **Cell being written:** a 1px ink outline, with the cell popover attached to its side.
- **Corner character:** in a written cell it is a 24px button (hover: solid ink) that opens that cell's popover again.

### Hint
A note for something that does not need to be on screen all the time: a count behind a progress ring, the reason a control is disabled, the name of an icon-only control in the closed rail. Solid ink, white text at 12px / 600 (tabular), 4px corner, 5px / 8px padding, 8px from what it describes, to its right or below it; it fades in over 140ms on hover or focus, and a touch or pen press shows it for about two seconds. It never carries an action.

### Write rail
232px (216px at ≤1100px), padding 15 / 16 / 16. Its top hangs on one leading column, 23px wide and centred 27.5px from the rail's left edge: the logo mark and each sentence's ring or check. From the top: the logo; the collected figure with its progress bar; the sentence list; then a 40px secondary icon button for the previous sentence beside the primary "다음 문장" (or "폰트 만들기" on the last sentence), with the ghost "지금 폰트 만들기" and the secondary existing-font button beneath. Pressing the logo mark closes the rail to 56px over 320ms: nothing in the leading column moves, sentence names are cut off by the rail's edge, text with no icon (the wordmark, the figure, the list's heading) fades out in 100ms, and the collected progress stands upright in the space the figure and the list heading leave (a 6px track from the top of that block down to 6px above the list, filling from the bottom). The two sentence buttons stack as icons and the two buttons beneath them are not shown. Closed, a hint names each row. The state is kept on the device.

### Tool rail
A 56px white column at the stage's left with a 1px ink right edge. It does not scroll. Icon buttons only, 40px, 18px Lucide icons, each with an aria-label and title: pen, eraser, a rule divider, undo, redo, a divider, clear sentence; writing settings sits at the bottom. The tool in use is solid ink. Writing settings opens a 248px white panel with a 1px ink border to the right of its button (cell size, stroke width, hand-shake correction, the guide toggle; the cell size is disabled once strokes exist and says why in a hint); it closes on a press anywhere else or Escape.

### Cell popover
A 148px white panel with a 1px ink border, attached to the right edge of the cell being written (to the left edge in the last column), its two inner corners square. From the top: the jamo the cell collects as a segmented control (the one being written solid ink, a done one on a 40% lime tint with a 10px check, one not yet reachable at 40%), the jamo's role and "남은 획 N" (the number at 18px / 800, tabular), then a small secondary button that ends the jamo early. Pressing another jamo moves collection to it. When the cell finishes the popover closes, so the next cell is free; reopened from the corner character it shows "수집 완료" and a close button.

### Cards and glyph cells
- **Example card:** white, 1px rule border, 6px corner; a square canvas over a caption row separated by a rule line. No shadow, no hover lift.
- **Glyph cell:** 52px high, 22px glyph in the user's font, no border; hover is ground, selected is solid ink with a white glyph, a modified glyph carries a 6px dot at top right (ink, or lime when selected).
- **Source link:** a full-width row with a rule border and a chevron; on hover the border turns ink and the row fills lime.

### The generation film (signature)
One canvas filling the stage, redrawn every frame from a clock and from the worker's real progress. The rail carries the headline, one sentence explaining the live step, the twelve-step list (it scrolls inside the rail when the rail is short, keeping the live step in view), the percent figure with progress and the worker's message, then skip (secondary) and cancel (ghost).

The specimens are up to three syllables the writer wrote whole, of different layouts (vowel beside, vowel below, with a final), from the sentence they just left. They stand in a row of equal square boxes (46% of stage height, max 340px, 32px apart) centred at 43% of the stage height, and go through every step together, each 5% behind the one before. Their strokes change pose in place:

| # | Step | Starts at | What the strokes do |
|---|------|-----------|---------------------|
| 1 | 원본 필기 | 0s | The sentence sits exactly where it was on the writing page; the other cells fade and the specimens' cells travel into their boxes. |
| 2 | 간격·비율 학습 | 1.4s | Ink fades to 35%. Dimension lines with end ticks grow on each specimen: the height of the syllable at its left, and the space between its jamo on a 7px lime band. Then two dotted lines (1 4) mark the height every syllable is brought to and the height dimension settles onto them. Each dimension carries its measure as a share of the cell (12px, 700). A caption gives the number of syllables measured. |
| 3 | 손떨림 보정 | 3.1s | Ink fades to 10%; the sampled path shows as a thin ink line with dots, the raw path stays behind as a 5px lime trace while the line settles. A round glass at the box's top right (17% of the box, 1px ink ring) shows, four times larger, the place the correction moves the path most; a small ring marks that place on the specimen. |
| 4 | 윤곽선 만들기 | 4.6s | The line swells to pen width, becomes a lime shape with a 2px ink contour, then fills ink. |
| 5 | 자모 분리 | 5.3s | Each stroke first shows its place in the writing order in a 9px ink disc with a white number; then each jamo drifts apart into its own labelled 1px box: initial outlined, medial on a lime fill, final dashed. |
| 6 | 크기 정규화 | 6.1s | The boxed jamo move into a row of equal tiles. |
| 7 | 문맥형 선택 | 7.2s | Under each tile, one small square per context form of that jamo (8 for an initial, 2 for a medial, 1 for a final): ink for a form that was written, a dashed outline that fills lime for one borrowed from the nearest form. Beneath, "8벌 중 5벌 씀" in ink-2. A caption gives the share of all placements that use a written form. |
| 8 | 문맥별 조합 | 8.7s | The jamo fly into the zones of a composed syllable, then the same jamo are shown in up to three sibling syllables, with a caption. |
| 9 | 받침 가운데 맞춤 | 9.9s | Each box shows a syllable with the same upper jamo and a final placed by rule. A dimension line grows above it from the left of the upper pair to the right of the vowel's stem (to the right of the pair when there is no stem); a dot and a dotted line (1 4) mark the target, labelled 60% or 가운데. Under the final, a rule line shows its whole width, a 6px lime band the bulk of its ink and a 2px ink tick the middle of that band; the final then slides from where centring its box would put it to where centring its ink puts it. See `docs/decision/final-optical-centre`. |
| 10 | 윤곽 병합 | 12.3s | The syllable as separate overlapping closed lines (lime, 2px ink contour) becomes one merged outline, then fills ink. |
| 11 | 11,172자 조합 | 13.0s | The first specimen's box shrinks into a window at the top showing the syllable being composed, over a running count. Below it, one lane per worker (12px, 22px apart, labelled with its run of initials) fills in ink with a 6px lime front. |
| 12 | OTF 묶기 | when done, no earlier than 13.7s | Over 0.6s the lanes slide into one strip in code order, 가 at its left and 힣 at its right. |

- **Result trail:** a row of ten small tiles at the bottom of the stage, one per specimen step. Steps not reached are dashed rule outlines, the live one is a 1px ink outline. When a step ends its result leaves the first specimen's box and docks in its tile over 0.4s, so what is done stays on screen and the next step starts from it.
- **Hand-over:** after the strip, each syllable of the preview's first sentence rises from its own place on the strip (25ms apart, 450ms each) and lands at the exact position and size the preview sets it at, while the window, the strip and the trail fade. The preview then opens with that sentence already standing there; only its controls and sample rows arrive.
- **Length:** the film runs at least 13.7s even if the font is ready sooner: 13s on the specimens, then 0.7s of lanes. With the join (0.6s) and the hand-over (about 0.9s) it is about 15s.
- **Pace follows the work:** the steps on the specimens take the time composition takes. While the font is being composed the film clock slows, to no less than a third of its speed, so that the lanes open when about 88% of the syllables are composed; the lanes themselves then last under a second. On a fast machine the film simply runs at its own speed.
- **Regeneration:** plays the same film from the first step. Composing takes the same time either way, so there is no short version.
- **Skip:** jumps the clock to the end of the film; the lanes then simply follow real progress. The control disappears once the film has played.
- **Progress is real:** each lane's fill is the share of its own range that worker reports; with no child workers there is one lane, filled from the overall progress (3–94% mapped to 0–1). Fills ease toward their target with a 120ms time constant. The percent and message in the rail are the worker's own. Steps 1–10 are a replay, on the specimens, of work the pipeline does in milliseconds; nothing is shown that the pipeline does not do.
- **Colour in the film** is the system's: ink strokes, rule for empty tracks and boxes, lime for the live part. Step easing is a quartic ease-out.
- **Failure:** a white panel with a 1px red border replaces the centre of the stage, with a red heading, the message, and a primary retry.

### Arrival in the preview
Arriving from generation, the first sentence is already in place: the film ends with its glyphs standing exactly where the text area shows them, so the stage cross-fade leaves them still. The sample rows settle in below (520ms each, 60ms apart). Arriving any other way, the page is simply there.

Sample rows are full-width lines at 30px in the user's font in ink-2, divided by rule lines; on hover the text turns ink and slides 10px right. A row whose characters were never written falls back to 16px in the interface font and says so.

## Do's and Don'ts

### Do:
- **Do** build a flow page from the frame: lime rail (280px, 1px ink right edge), white stage, primary action in solid ink at the rail's bottom.
- **Do** mark the selected, current or pressed thing with solid ink and white text, and use lime text only on that ink.
- **Do** use lime-ink for secondary text on lime and ink-2 / ink-3 for secondary text on white and ground.
- **Do** keep every control at a 6px corner (4px when nested), every structural line at 1px ink, every quiet line at 1px rule.
- **Do** show any wait or computation on the user's own strokes and drive it from real progress.
- **Do** carry a navigation inside the flow with the `rail` and `stage` transitions, and keep every animation on `cubic-bezier(.16, 1, .3, 1)`.
- **Do** give every animated behaviour a still equivalent under reduced motion that shows the same information.
- **Do** set changing numbers in tabular figures and keep 12px as the smallest size.
- **Do** put a destructive choice in a dialog, in the destructive button style.

### Don't:
- **Don't** add a colour. No blue, no second accent, no status greens or ambers; state is ink, lime, or red for failure.
- **Don't** set lime text on white or ground, or use lime for a button outside a solid ink surface.
- **Don't** use shadows for lift, blur, glass, or gradients for tone. `box-shadow` is a zero-blur line or nothing.
- **Don't** replace the handwriting with a spinner, skeleton, or stock progress illustration.
- **Don't** imitate paper, notebooks or stationery, and don't drift toward a white-and-blue SaaS shell or a dark technical theme.
- **Don't** introduce a second interface typeface, or set interface text in the user's font.
- **Don't** move the primary action out of the rail's bottom on a flow page.
- **Don't** let an animation bounce, loop, or run longer than the thing it explains; the film's length is set by the steps, not by decoration.
