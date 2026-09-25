# Design System

## 1. Product Character

This product turns a user's handwritten characters into a usable font.

The interface should feel like a focused creative tool, not a SaaS dashboard.

Visual direction:

* Bright
* Minimal
* Precise
* Calm
* Modern
* Slightly expressive
* Tool-like rather than decorative

The overall feel should sit between the restraint of Linear and the subtle personality of Raycast.

The interface should remain visually quiet so the user's handwriting becomes the most expressive element on screen.

---

## 2. Core Product Principle

The product has one primary flow:

**Start → Write → Generate → Preview → Download**

There is:

* no authentication
* no user profile
* no dashboard
* no workspace
* no saved font library
* no account navigation
* no cloud project management

Do not introduce conventional SaaS patterns that are unrelated to this flow.

---

## 3. Primary Layout

The writing experience uses a two-column workspace.

### Left: Control Panel

The left panel contains:

* current character
* short instruction
* progress
* drawing controls
* previous / next navigation
* optional character overview

Recommended desktop width:

`240px – 280px`

The panel should remain visually compact.

It should never compete with the canvas.

### Right: Writing Canvas

The canvas is the dominant area of the interface.

It should occupy most of the available screen.

The user should immediately understand:

> This is where I write.

Avoid placing unrelated information inside or around the canvas.

---

## 4. Layout Hierarchy

The writing screen consists of four clearly defined regions.

### 4.1 Top Header

Position:

* spans the full width of the viewport
* sits above the writing workspace
* remains visually lightweight

Contains:

* product logo or wordmark aligned left
* Help action aligned right when needed

The header must not contain:

* account controls
* navigation menus
* workspace selectors
* project names
* save indicators

Recommended height:

`48px – 56px`

The header should visually recede behind the writing experience.

---

### 4.2 Main Workspace

Position:

* directly below the header
* fills the majority of the remaining viewport height
* displayed as two adjacent columns

Structure:

* left column: Control Panel
* right column: Writing Canvas

The workspace should feel continuous.

Do not visually separate the two columns as independent cards.

A subtle vertical border may divide them.

---

### 4.3 Left Control Panel

Position:

* fixed to the left side of the main workspace
* width between `240px` and `280px`
* full height of the main workspace

Content order from top to bottom:

1. Current character
2. Short instruction
3. Progress information
4. Drawing controls
5. Previous / Next navigation

Example content hierarchy:

**Current character**

`가`

**Instruction**

`이 글자를 써주세요`

**Progress**

`18 / 48`

Thin progress indicator may appear directly below the number.

**Canvas controls**

* Undo
* Erase
* Clear
* optional stroke width

**Navigation**

* Previous
* Next

The current character should be the strongest visual element inside the panel.

Controls should remain secondary.

The panel should not resemble application navigation.

---

### 4.4 Right Writing Canvas

Position:

* immediately to the right of the Control Panel
* fills all remaining horizontal space
* fills the available main workspace height

The canvas should:

* occupy the majority of the visual area
* provide generous empty space
* remain centered within its available region
* have minimal visual framing
* respond fluidly to viewport size

The canvas must not contain unrelated UI.

Do not place:

* progress information
* page navigation
* help text
* settings
* toolbars unrelated to handwriting

inside the drawing surface.

The canvas itself is the primary workspace.

---

### 4.5 Character Overview

The character overview provides awareness of overall progress without interrupting the current writing task.

Preferred placement:

* below the main workspace
* full width, or aligned with the Writing Canvas region

Alternative placement:

* lower section of the Control Panel when screen height allows

It should display:

* completed characters
* current character
* remaining characters

When practical, completed characters should use miniature previews of the user's actual handwriting.

The overview should remain visually secondary.

It must not become a dashboard, table, or navigation system.

---

### 4.6 Visual Priority

The screen should follow this visual priority:

1. Writing Canvas
2. Current Character
3. Next Action
4. Progress
5. Drawing Controls
6. Header
7. Character Overview

If two elements compete for attention, the higher-priority element should dominate.

The Writing Canvas should always remain the strongest region of the interface.

---

## 5. Color System

Use an almost monochrome interface with one primary accent color.

### Primary

Cobalt Blue:

`#2457F5`

Use it intentionally and sparingly.

Good uses:

* primary action
* current character indicator
* active state
* focus ring
* progress highlight
* selected character

Do not use blue for large decorative surfaces.

### Background

Application:

`#F8F9FB`

Primary surfaces:

`#FFFFFF`

Canvas:

`#FCFCFD`

### Text

Primary:

`#17181A`

Secondary:

`#62656B`

Muted:

`#92969D`

### Borders

Default:

`#E5E7EB`

Subtle:

`#EEF0F2`

Strong:

`#D5D8DD`

---

## 6. Color Usage

The interface should mostly appear neutral.

Approximate visual balance:

* 85–90% white / neutral
* 8–12% dark typography and borders
* 2–5% cobalt blue

Cobalt is an interaction color, not a decorative theme color.

Avoid:

* blue gradients
* glowing blue elements
* large blue cards
* blue tinted page backgrounds
* gradient text

---

## 7. Typography

Use a clean sans-serif UI font.

Preferred:

* Geist
* Inter as fallback

Typography should feel compact and precise.

### Suggested hierarchy

Page / major state title:

`24–28px / 600`

Current character:

`56–72px / 500`

Section heading:

`16px / 600`

Body:

`14px / 400`

Secondary text:

`13px / 400`

UI labels:

`12–13px / 500`

Do not use oversized marketing typography inside the writing interface.

---

## 8. Spacing

Use a 4px base spacing system.

Common values:

* 4
* 8
* 12
* 16
* 20
* 24
* 32
* 48

Prefer whitespace over decorative containers.

Do not create a card simply to separate every group of controls.

---

## 9. Radius

Use restrained corner rounding.

Default controls:

`8px`

Small controls:

`6px`

Large surfaces:

`10px`

Avoid:

* excessive pill shapes
* 16px+ rounded cards everywhere
* fully rounded controls unless structurally appropriate

Buttons should generally not look like capsules.

---

## 10. Shadows

Use shadows very sparingly.

Most surfaces should use borders instead.

Default:

No shadow.

Floating overlay:

Very subtle shadow only when depth is necessary.

Do not use shadows to make every container appear elevated.

---

## 11. Writing Canvas

The canvas is the visual center of the product.

It should feel digital and precise rather than paper-like.

Do not imitate:

* notebook paper
* textured paper
* pencil sketches
* torn edges
* physical stationery

The canvas should integrate naturally into the application surface.

A subtle boundary is enough.

Possible treatment:

* `1px` neutral border
* `8px` radius
* near-white surface

The canvas should provide generous empty space.

---

## 12. Excalidraw Usage

Excalidraw is used as a drawing engine, not as the visible product interface.

Do not expose unnecessary Excalidraw UI.

Hide or disable tools unrelated to handwriting:

* rectangle
* diamond
* arrow
* text
* image
* library
* collaboration
* file controls

The primary interaction is free drawing.

Expose only the controls the user needs:

* Undo
* Erase
* Clear
* optional stroke width

Application controls should use the product's own UI.

---

## 13. Character Workflow

The user focuses on one character at a time.

The active character should be visually obvious.

Display:

* the target character prominently
* one short instruction beneath it

Example:

Target character: `가`

Instruction: `이 글자를 써주세요`

Avoid long explanations.

The user should be able to:

1. write
2. undo or clear
3. accept the character
4. continue

Navigation should require minimal cognitive effort.

---

## 14. Character Progress

The interface should show lightweight awareness of overall progress.

Primary progress format:

`18 / 48`

An optional thin progress indicator may appear beneath it.

Additionally, show completed characters as a compact overview.

Each character has one of three states:

* completed
* current
* remaining

When possible, completed characters may display miniature previews of the user's actual handwriting.

This should feel like the font is gradually coming to life.

Do not turn this into a dashboard or analytics component.

---

## 15. Controls

Prefer text combined with simple functional icons.

Core actions:

* Undo
* Erase
* Clear

Controls should be understated until needed.

Primary actions receive cobalt blue.

Secondary actions stay neutral.

Destructive actions should not become visually dominant unless confirmation is required.

---

## 16. Buttons

Primary:

* cobalt blue background
* white text
* 8px radius
* medium font weight
* restrained height

Secondary:

* white or transparent
* subtle border
* dark text

Ghost:

* transparent
* no border
* used for low-priority canvas controls

Avoid:

* gradients
* oversized buttons
* glossy treatments
* pill-shaped CTA buttons
* icons added only for decoration

---

## 17. shadcn/ui

Use shadcn/ui as the primary UI component foundation.

Prefer existing shadcn primitives when appropriate.

Good candidates:

* Button
* Tooltip
* Dialog
* Dropdown Menu
* Progress
* Separator
* Toast
* Slider

Do not preserve default shadcn styling blindly.

All components must follow this document's:

* colors
* radius
* typography
* spacing
* interaction patterns

Do not add another general-purpose component library without a clear technical reason.

---

## 18. Motion

Motion should be fast and functional.

Good uses:

* active character change
* progress updates
* subtle button state changes
* drawing completion
* preview transition

Typical duration:

`120–220ms`

Avoid:

* bouncing elements
* dramatic spring animations
* decorative floating objects
* unnecessary page transitions
* animations that delay drawing

The interface should feel responsive rather than animated.

---

## 19. Font Generation State

Font generation should feel intentional but not theatrical.

Avoid fake AI-style loading experiences.

Do not use:

* glowing orbs
* AI sparkles
* rotating gradient borders
* fake processing logs

Prefer a simple status such as:

**폰트를 만들고 있어요**

`글자 형태를 정리하는 중…`

with a subtle progress treatment.

---

## 20. Final Preview

The generated font itself should be the hero.

The UI should step back.

Show a large sample sentence using the generated font.

Then allow the user to explore it through:

* sample sentence
* Hangul character set
* Latin characters if supported
* numbers if supported
* editable preview field

Example preview content:

`오늘 하루도 좋은 하루 보내세요.`

`가나다라마바사아자차카타파하`

`ABCDEFGHIJKLMNOPQRSTUVWXYZ`

`0123456789`

The Download button should be visible but should not visually overpower the font preview.

---

## 21. Anti-Patterns

Do not use:

* excessive gradients
* glassmorphism
* gradient text
* decorative glow
* random purple accents
* oversized hero sections
* unnecessary badges
* excessive rounded cards
* cards inside cards
* excessive pill-shaped controls
* large drop shadows
* floating AI icons
* sparkles
* confetti by default
* generic SaaS dashboards
* sidebar navigation
* profile avatars
* workspace switchers
* notification centers
* fake saved states
* "My Fonts" interfaces
* decorative icons without purpose

---

## 22. AI Implementation Rules

When implementing UI:

1. Read this document before making visual decisions.
2. Preserve the left-control / right-canvas structure.
3. Use shadcn/ui for standard UI primitives.
4. Treat Excalidraw as a drawing engine only.
5. Keep surfaces bright and neutral.
6. Use Cobalt Blue only for important interactive states.
7. Do not introduce additional visual styles without a product reason.
8. Prefer whitespace and typography over containers.
9. Keep the user's handwriting visually dominant.
10. When uncertain, choose the simpler solution.

The interface should never look more expressive than the font the user is creating.
