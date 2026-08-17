# Preview Studio Dark visual refresh

## Goal

Refresh `preview-studio-dark.html` into a coherent darkroom-console interface for a photography colour-grading workflow. The page should feel like a focused professional tool: calm graphite surfaces, a warm amber control accent, and strong scanability for long-form analysis and parameter recommendations.

## Scope

- Preserve the existing information architecture, section IDs, Chinese copy, dark/light theme switching, and inline interactions.
- Establish a consistent darkroom-console visual system: graphite neutrals, one amber accent, semantic success/warning/risk colours, 10px control and container radii, serif display headings, and monospace parameter values.
- Strengthen hierarchy in the persistent navigation, top status bar, upload comparison, workflow steps, analysis report, parameter-plan cards, export area, preference controls, privacy summary, modal, and transient feedback.
- Add restrained interaction feedback for hover, active, focus, and reduced-motion preferences.
- Validate the static desktop page in a local browser.

## Explicitly out of scope

- Mobile-specific layout or responsive redesign.
- Changing copy, route/anchor IDs, form field order, data handling claims, or JavaScript behavior.
- Replacing the illustrative photo placeholders with new photographic assets.

## Design system

- Theme: retain the existing light/dark capability. The dark theme is the primary design target and will keep a single graphite surface family.
- Accent: amber remains the sole global accent. It indicates current selection, primary action, active progress, and editable parameter values.
- Semantic colour: green denotes safe/accepted states; red denotes constraints or risk. Both remain subordinate to amber.
- Geometry: all panels, thumbnail frames, and controls use a 10px radius; chips and avatars retain pill/circle geometry only where their interaction pattern requires it.
- Type: keep the existing CJK-safe UI sans stack, Georgia/Songti heading stack, and Cascadia/Consolas parameter stack. Increase contrast and scale distinction instead of adding external fonts.

## Component changes

1. **App chrome**: give the sidebar a quieter surface and a stronger active-navigation rail; reduce top-bar visual noise and improve status/action grouping.
2. **Introduction and upload comparison**: make the welcome block concise; improve photo framing, metadata legibility, and the visual relationship between A/B inputs.
3. **Workflow and report**: use a continuous, readable progress rail; group the reference analysis into clearer identity, histogram, and migration-decision zones.
4. **Parameter plan**: make stage labels feel structural rather than decorative. Rework parameter cards around a predictable header, value, safe range, visual range bar, reason, expected result, and explicit risk state.
5. **Export, feedback, preferences, and privacy**: apply consistent focus/hover/pressed states, clearer empty/upload states, and calmer low-priority containers.
6. **Modal and toast**: improve focus contrast, action hierarchy, and opacity against the backdrop without changing existing behavior.

## Interaction and accessibility

- Visible keyboard focus rings use the amber accent with enough contrast on both themes.
- Primary buttons have dark text on amber; secondary actions retain a clear border and hover state.
- Controls receive a small pressed-state translation; all nonessential transitions are disabled under `prefers-reduced-motion: reduce`.
- Existing labels, button text, and interaction handlers remain unchanged.

## Verification

- Open the page locally and verify dark theme, light theme, nav anchors, scene chips, feedback marks, toggles, login modal, XMP toast, and theme persistence.
- Inspect desktop widths from 1024px through 1440px for clipping, wrapped primary actions, and visual hierarchy regressions.
- Confirm contrast and focus states manually for primary actions, controls, inputs, alerts, and tags.

## Self-review

- No placeholders, conflicting requirements, or undefined implementation decisions remain.
- Scope is confined to the single static preview page and explicitly excludes mobile work.
- Existing anchors, copy, fields, and behavior are preserved.
