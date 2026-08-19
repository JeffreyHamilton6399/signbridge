# Accessibility

An app for Deaf and hard-of-hearing users that is only usable by people with
good vision, fine motor control, and a mouse has missed the point twice.

## Who is actually using this

- **Deaf and hard-of-hearing signers** — the primary users. Many will be
  bilingual in ASL and written English; many will not read English fluently,
  since ASL is a separate language and English is often an L2.
- **DeafBlind users** — some with usable residual vision, needing very large
  type and maximum contrast; some using a braille display, for whom every piece
  of state must exist as text.
- **Hearing people who sign a little** and are trying to communicate.
- **Hearing people who do not sign at all**, reading captions.

## What is implemented

### Keyboard

Every control is reachable and operable by keyboard. Focus rings are visible
(`:focus-visible`, 3px, high-contrast) and are never removed.

| Key | Action |
|---|---|
| `Tab` | Move focus; first stop is a skip link to the controls |
| `Space` | Commit the current word (insert a space) |
| `Backspace` | Delete a letter; at a word boundary, pull the last word back for editing |
| `F` | Fix the last word |
| `R` | Read the transcript aloud |
| `E` | Export the transcript |
| `D` | Toggle the debug panel |
| `,` | Open settings |
| `Esc` | Close the topmost panel |

Shortcuts are suppressed while focus is in a text field, so typing in Reverse
mode does not trigger them. Each button also carries `aria-keyshortcuts`.

### Screen readers

- The caption region is `aria-live="polite"` with `aria-atomic="false"`, so new
  words are announced without re-reading the whole transcript.
- The confidence bar is a `role="meter"` with a text label that includes the
  percentage and the letter being held — the visual bar is never the only
  carrier of that information.
- The disclaimer is a `role="note"`, present in the accessibility tree from
  first paint.
- Every toggle is a `role="switch"` with `aria-checked`; every mode button
  carries `aria-current`.
- Panels are `role="dialog"` with `aria-modal` and a name.

### Low vision

- Caption sizes from 28px to 104px.
- Caption position: bottom, top, or a side panel, so captions can be moved away
  from where the OS puts its own overlays.
- A high-contrast theme (pure black/white, yellow signal colour) beyond the
  normal light/dark pair.
- Confidence is encoded in weight and opacity **and** in a separate bar **and**
  in text — never in colour alone.
- Committed low-confidence words get a dotted underline rather than being
  dimmed, so they stay readable at distance.

### Motor

- Controls sit at the extreme edges of the frame, never in the centre-bottom
  where hands are — you are not fighting your own signing hand for the buttons.
- Dwell time is adjustable from 200 ms to 1500 ms, which is also the main lever
  for users with tremor or limited range of motion.
- Correction is one tap from the caption, and one tap from the alternates strip.
- No gesture is required to operate the app; every gesture has a button.

### Motion and cognition

- `prefers-reduced-motion` is respected automatically, and there is an explicit
  override in Settings for users whose OS setting does not reflect what they
  want here.
- The commit animation is the only non-trivial motion in the app, and it is the
  first thing reduced-motion disables.
- OpenDyslexic and a plain system face are offered alongside the display face.
- Error messages state what happened and what to do: "Camera is in use by
  another app. Close it and tap Retry," never "An error occurred."

### Haptics and audio

- Vibration on commit (mobile), off-switchable.
- An optional short click on commit — deliberately not a notification chime.

## What is not done yet

Being honest about the gaps is part of the point:

- **No braille display testing.** The ARIA is written correctly, but nobody has
  driven this with a refreshable braille display.
- **No screen reader testing with actual users.** NVDA, JAWS and VoiceOver
  behaviour has been reasoned about, not observed.
- **The tutorial is text.** An app for signers should explain itself in ASL
  video. It does not yet.
- **No ASL UI language option.** Menu labels are English only.
- **Captions cannot be repositioned by dragging**, only by the three presets.

## Testing checklist

Before any release:

- [ ] Full keyboard pass with no mouse, including every panel
- [ ] VoiceOver (macOS/iOS), NVDA (Windows), TalkBack (Android)
- [ ] 200% browser zoom, then 400%
- [ ] High-contrast theme with Windows high-contrast mode also on
- [ ] `prefers-reduced-motion: reduce` set at OS level
- [ ] Caption legibility at "Huge" from three metres away
- [ ] Colour-blind simulation (deuteranopia, protanopia) on the confidence states
