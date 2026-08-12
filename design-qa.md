# Design QA

## Comparison target

- Reference: Egoist AI Passport landing page, `https://ego.ist/`, captured in the in-app browser at a 1230 px desktop viewport.
- Implementation: Handshake claimant request, `http://handoff.127.0.0.1.nip.io:4174/`, captured at the same desktop viewport and compared side by side with the reference.
- Intent: directional translation, not a page clone. Handshake keeps its consent workflow and content while adopting Egoist's sparse, editorial visual language.

## Final pass

No P0, P1, or P2 visual findings remain.

### Fonts and typography

- The implementation uses the existing system sans stack with a high-contrast display heading, compact uppercase labels, and a quieter body scale. This matches the reference's editorial hierarchy without borrowing Egoist's product copy.
- Heading wraps are intentional at the desktop width and retain a readable line length.

### Spacing and layout rhythm

- The consent request has a single centered frame, ample page whitespace, a 28 px surface radius, consistent dividers, and a clear reading order: request, recipient, purpose, selected fields, duration, decision.
- The recipient console uses the same frame, header treatment, spacing scale, and compact status treatment.

### Colors and visual tokens

- Near-white page and surface tones, charcoal primary actions, muted gray metadata, and restrained semantic badges align with the reference's low-chroma direction.
- Safety and access states retain distinct contrast, so the visual simplification does not hide meaning.

### Image and icon fidelity

- No reference imagery is needed for the product workflow. The implementation uses no replacement illustration, custom SVG, or decorative CSS art.
- The former symbolic outcome glyphs were replaced with textual status pills, which are clearer and consistent with the visual system.

### Copy and interaction states

- The claimant copy now explains the user decision in plain terms: exact fields, recipient, and expiration.
- Checkbox selection, duration selection, and opening and closing the custom-allergy editor were checked in the browser. The isolated test hostname cannot run the final approval action because that nonstandard browser origin does not provide `crypto.randomUUID`; the protocol suite passes and the normal local demo origin already contains a revoked demo claim, so this is not a visual regression.
- The recipient empty state was captured and remains explicit about the prerequisite active approval.

### Accessibility and resilience

- Existing semantic controls, labels, keyboard-focus styles, and live regions remain in place.
- The narrow-screen CSS rules preserve readable padding, stack action buttons, and remove nonessential header metadata.

## Final result: passed
