---
name: Sovereign Monochrome
colors:
surface: '#f9f9f9'
surface-dim: '#dadada'
surface-bright: '#f9f9f9'
surface-container-lowest: '#ffffff'
surface-container-low: '#f3f3f4'
surface-container: '#eeeeee'
surface-container-high: '#e8e8e8'
surface-container-highest: '#e2e2e2'
on-surface: '#1a1c1c'
on-surface-variant: '#444748'
inverse-surface: '#2f3131'
inverse-on-surface: '#f0f1f1'
outline: '#747878'
outline-variant: '#c4c7c7'
surface-tint: '#5f5e5e'
primary: '#000000'
on-primary: '#ffffff'
primary-container: '#1c1b1b'
on-primary-container: '#858383'
inverse-primary: '#c9c6c5'
secondary: '#5f5e5e'
on-secondary: '#ffffff'
secondary-container: '#e2dfde'
on-secondary-container: '#636262'
tertiary: '#000000'
on-tertiary: '#ffffff'
tertiary-container: '#1b1c1c'
on-tertiary-container: '#848484'
error: '#ba1a1a'
on-error: '#ffffff'
error-container: '#ffdad6'
on-error-container: '#93000a'
primary-fixed: '#e5e2e1'
primary-fixed-dim: '#c9c6c5'
on-primary-fixed: '#1c1b1b'
on-primary-fixed-variant: '#474646'
secondary-fixed: '#e5e2e1'
secondary-fixed-dim: '#c8c6c5'
on-secondary-fixed: '#1c1b1b'
on-secondary-fixed-variant: '#474746'
tertiary-fixed: '#e3e2e2'
tertiary-fixed-dim: '#c7c6c6'
on-tertiary-fixed: '#1b1c1c'
on-tertiary-fixed-variant: '#464747'
background: '#f9f9f9'
on-background: '#1a1c1c'
surface-variant: '#e2e2e2'
typography:
display-hero:
fontFamily: Playfair Display
fontSize: 56px
fontWeight: '400'
lineHeight: 64px
letterSpacing: -0.02em
display-hero-mobile:
fontFamily: Playfair Display
fontSize: 36px
fontWeight: '400'
lineHeight: 44px
letterSpacing: -0.01em
headline-lg:
fontFamily: Playfair Display
fontSize: 40px
fontWeight: '400'
lineHeight: 48px
letterSpacing: -0.015em
headline-lg-mobile:
fontFamily: Playfair Display
fontSize: 28px
fontWeight: '400'
lineHeight: 36px
letterSpacing: -0.01em
headline-md:
fontFamily: Playfair Display
fontSize: 28px
fontWeight: '500'
lineHeight: 36px
letterSpacing: -0.01em
headline-sm:
fontFamily: Playfair Display
fontSize: 20px
fontWeight: '600'
lineHeight: 28px
letterSpacing: '0'
title-lg:
fontFamily: Inter
fontSize: 18px
fontWeight: '600'
lineHeight: 24px
letterSpacing: -0.01em
title-md:
fontFamily: Inter
fontSize: 15px
fontWeight: '500'
lineHeight: 20px
letterSpacing: -0.005em
body-lg:
fontFamily: Inter
fontSize: 16px
fontWeight: '400'
lineHeight: 26px
letterSpacing: '0'
body-md:
fontFamily: Inter
fontSize: 14px
fontWeight: '400'
lineHeight: 22px
letterSpacing: '0'
body-sm:
fontFamily: Inter
fontSize: 12px
fontWeight: '400'
lineHeight: 18px
letterSpacing: '0'
label-caps:
fontFamily: Inter
fontSize: 11px
fontWeight: '600'
lineHeight: 14px
letterSpacing: 0.08em
metric-display:
fontFamily: Inter
fontSize: 32px
fontWeight: '500'
lineHeight: 36px
letterSpacing: -0.02em
metric-md:
fontFamily: Inter
fontSize: 20px
fontWeight: '500'
lineHeight: 24px
letterSpacing: -0.01em
spacing:
gutter: 1.5rem
gutter-desktop: 2.5rem
margin: 1.25rem
margin-tablet: 2.5rem
margin-desktop: 4rem
space-xs: 0.25rem
space-sm: 0.5rem
space-md: 1rem
space-lg: 1.75rem
space-xl: 3rem
Brand & Style
This design system embodies the austere, uncompromising authority of elite global alternative asset management. Built on principles of institutional prestige, legacy, and architectural discipline, the aesthetic projects gravitas, immense capital certainty, and discreet power.
The visual direction rejects superficial ornament, vibrant accent tones, and ephemeral UI trends. Instead, it pairs classical editorial luxury with razor-sharp financial precision. The emotional tone must evoke high fiduciary trust, calculated intellect, and enduring stability. Every layout behaves like a curated annual review or an executive prospectus: structured, spacious, uncompromisingly legible, and mathematically aligned.
Colors
The palette is strictly achromatic, leveraging the contrast between pure light foundations and pitch-black structural layers.
Primary (`#0a0a0a`): The deep anchor tone applied to primary serif titles, key figures, active tab indicators, and primary callouts.
Secondary (`#171717`): Dense carbon black for body copy, subheaders, and structural framing.
Tertiary (`#737373`): Restrained stone gray reserved for metadata, tickers, captions, inactive states, and financial column identifiers.
Neutral (`#ffffff`): Pure white base for default surface canvas.
Surface & Structural Grays:
Light Ground (`#fcfcfc` to `#f5f5f5`): Background fills for data table headers, nested stat panels, and alternate ledger rows.
Hairline Border (`#e5e5e5`): High-definition single-pixel partition lines for row dividers, column boundaries, and perimeter containment.
Inverted Dark Substrates (`#111111` surface, `#262626` border): Used selectively for executive briefing cards, high-conviction metrics, or modal presentation trays.
Color is strictly excluded as a vehicle for decorative flair. Semantic performance indicators (positive/negative variances) rely on directional typography, minimal glyphs (↑ / ↓), or subtle font weight differentials rather than saturate greens or reds, preserving absolute institutional detachment.
Typography
The typographic hierarchy pairs the literary authority of Playfair Display with the functional precision of Inter.
Editorial Headings: Playfair Display is reserved exclusively for primary titles, narrative commentary, fund performance overviews, and section demarcations. It anchors the interface with an atmosphere of heritage.
Precision Data & Structure: Inter handles all transactional interfaces, data tables, metrics, operational labels, and continuous body text. Numerical figures must enforce tabular figures (`font-variant-numeric: tabular-nums; lining-nums;`) to achieve vertical column alignment across balance sheets and asset registers.
Labels & Sub-metadata: Always use `label-caps` in uppercase with expanded tracking (`0.08em`) to distinguish metric classifications (e.g., "AUM", "NET IRR", "COMMITTED CAPITAL") from dynamic figures.
Layout & Spacing
Layout follows an architectural 12-column grid prioritizing expansive horizontal margins, strict alignment, and calibrated whitespace.
Grid Architecture:
Desktop (>1200px): 12-column layout with 4rem outer margins and 2.5rem gutters, allowing generous whitespace for long-form reporting and complex multi-column metric arrays.
Tablet (768px - 1199px): 8-column layout with 2.5rem outer margins and 1.5rem gutters.
Mobile (<768px): 4-column layout with 1.25rem margins and 1rem gutters. Complex data grids collapse into stacked key-value summaries.
Rhythm: Spacing follows an intentional cadence: tight, dense spacing within data blocks (`space-xs` and `space-sm`) to preserve cohesion among tabular figures, contrasted against dramatic, generous macro-spacing (`space-xl` and above) separating distinct portfolio strategies, executive dispatches, and sectional disclosures.
Elevation & Depth
This design system avoids simulated atmospheric shadows, blur effects, or diffuse ambient lighting. Depth is articulated entirely through structural line-work, tonal shifting, and planar layering.
Hairline Dividers: Structural boundaries utilize 1px solid borders (`#e5e5e5` on light surfaces; `#262626` on dark substrates). Sections are partitioned by razor lines rather than floating dropshadows.
Layered Tonality: Depth is indicated through subtle contrast changes: default background (`#ffffff`), secondary utility background (`#fcfcfc`), card fill (`#ffffff` framed in 1px `#e5e5e5`), and header/active rows (`#f5f5f5`).
Overlays & Drawers: Modals, filter panels, and financial detail drawers use flat, opaque surfaces framed by crisp 1px borders, accompanied by an absolute matte scrim (`rgba(10, 10, 10, 0.45)`) without backdrop filters or blurs.
Shapes
The shape system enforces pure architectural geometry. Radius is set strictly to `0px` across every element: buttons, input fields, badges, data cells, cards, and modal sheets.
Sharp corners reinforce the discipline of institutional ledgers, structural stone buildings, and classical publication layout. Soft contours, pill shapes, and organic radii are entirely prohibited.
Components
Buttons
Primary: Solid `#0a0a0a` background, `#ffffff` text, 0px border radius, sharp 1px border (`#0a0a0a`). Inner padding: 12px vertical by 24px horizontal. Typography: `label-caps`. Hover: Background transitions to `#262626`.
Secondary / Ghost: `#ffffff` background, `#0a0a0a` text, crisp 1px border (`#e5e5e5`). Hover: Border transitions to `#0a0a0a`, background to `#f5f5f5`.
Minimal / Link: Transparent background, `#0a0a0a` text, bottom hairline border (`#0a0a0a`) offset by 4px. No side padding.
Cards & Ledger Blocks
Enclosed with a 1px solid `#e5e5e5` border, flat `#ffffff` ground. Padding strictly adhering to `space-lg`.
Metric cards feature an uppercase caption (`label-caps` in `#737373`), a primary stat in `metric-display` (`#0a0a0a`), and optional trailing delta info separated by a faint horizontal divider.
Data Tables & Tabular Rows
Header cells: `label-caps` in `#737373`, height of 40px, bottom border 1px solid `#0a0a0a`, background `#fafafa`.
Data rows: 48px standard row height, 1px bottom border `#e5e5e5`. Cells display numeric data using `Inter` with tabular lining figures, aligned strictly right. Text and identifiers are aligned left. Hover state: `#f9f9f9` fill across the entire row.
Form Inputs & Selectors
Flat rectangular field, 44px height, 1px `#e5e5e5` border, `#ffffff` fill. Padding: 0 16px.
Focus state: Border shifts instantly to 1px `#0a0a0a`. No outline rings or glow shadows. Placeholder text in `#a3a3a3`.
Chips, Badges & Asset Class Identifiers
Compact rectangular frames (22px height), 1px solid border (`#e5e5e5`), zero border radius.
Background: `#f5f5f5` or transparent. Text: `label-caps`, `#171717`. Never uses bright contextual pills or round status dots.
Checkboxes & Radios
Checkboxes: 16px square, 0px radius, 1px solid `#737373`. Checked state: solid `#0a0a0a` fill with an ultra-fine white geometric check mark.
Radios: 16px outer square (retaining sharp geometric identity), 1px solid `#737373`. Checked state: nested solid `#0a0a0a` square inner fill (8px).
Editorial & News Feed Layout
News items feature a 2-column or grid pattern: Left metadata column (Timestamp and Strategy Tag in `label-caps`), right content column (Title in Playfair Display `headline-sm`, followed by a brief summary in `body-sm`).
Each entry is demarcated by a full-width 1px solid `#e5e5e5` horizontal rule.