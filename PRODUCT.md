# Product

## Register

product — finplan is a personal cash-flow planning tool (dashboard, tables, forms). Design SERVES the task. **Exception: the «Доска желаний» (wish/vision board) is the one expressive, emotional surface** — design carries feeling there, the rest stays restrained.

## Users
A single self-hosting user, planning their money privately. Most screens are dry, fast, dense (snapshots, obligations, inflows, course economics). The board is where he looks at *why* he's saving — his dreams — so it should feel aspirational, not like another spreadsheet.

## Product Purpose
See whether the cash curve clears the cushion, and what each dream costs relative to free headroom. The board turns abstract "savings" into concrete wants and shows, at a glance, which are within reach.

## Brand Personality
Calm, honest, quietly premium. Three words: **honest, aspirational, fast.** No hype, no gamification. The numbers tell the truth (по карману / впритык / не хватает); the board makes the truth beautiful.

## Anti-references
- Generic Pinterest/Unsplash masonry with uniform white caption pills (what the board currently looks like — competent but soulless).
- Fintech gamification: confetti, badges, progress-to-goal dopamine bars.
- SaaS-cream warm-neutral landing aesthetic; tiny uppercase eyebrows on every block.

## Design Principles
1. **The status is the spectacle.** Affordability (по карману/впритык/не хватает) isn't a tiny dot — it's the visual system. Reachable dreams should literally glow warmer/greener; far ones cooler. The wall = a living map of the journey.
2. **Bright images stay bright.** The board favors undarkened photos with readable captions; keep that. Drama comes from atmosphere, typography, light, and hierarchy — not by darkening the photos.
3. **Fast is non-negotiable.** GPU-cheap paint only (gradients, box-shadow, opacity, transform-on-hover). No per-card 3D layers at rest, no scroll-hijack libraries, native scroll, content-visibility for offscreen, downscaled images. Motion is one-shot reveal + hover, never per-frame work.
4. **One dream leads.** The top-priority «мечта мечт» gets a hero treatment; the rest support it. Avoid the uniform identical-card grid.
5. **Fullscreen is theatre.** The «Во весь экран» mode becomes a dark cinematic gallery where the photos glow — a private dream-cinema, distinct from the light inline board.

## Accessibility & Inclusion
Captions keep ≥4.5:1 contrast (text on its own pill/scrim, not on the raw photo). Respect `prefers-reduced-motion`: reveal/hover degrade to instant. Verdict is never color-only — always paired with a text label (по карману/впритык/не хватает) on hover.
