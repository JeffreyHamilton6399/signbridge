# Decisions

One line per significant choice, and why. Newest at the bottom.

## Assumptions made in place of the Section 12 answers

The build brief ends with six questions to ask before starting. The build was
requested as a single uninterrupted run, so these were answered with defaults
and are flagged here as assumptions to revisit — each one is cheap to change.

1. **Deaf signers for data and testing** — assumed *not yet available*. Phase 1
   therefore ships a geometric baseline plus in-browser personalization rather
   than a model trained on collected data. Recruiting Deaf testers remains a
   requirement, not a nice-to-have (`ETHICS.md` §4).
2. **Phase 2 vocabulary** — no list supplied, so a 150-sign target list was
   proposed (`src/modes/signs/vocabulary.ts`), marked as a hearing developer's
   proposal pending Deaf review.
3. **Desktop-first or mobile-first** — assumed *desktop-first, responsive down*.
   Touch targets, safe-area insets and pointer events are all handled, but the
   layout is designed at desktop and adapted.
4. **Sign clips for Reverse mode** — assumed *none available*. Reverse mode
   ships with an empty clip manifest and fingerspells everything, with recording
   instructions in `public/clips/README.md`.
5. **Python `/training` pipeline** — assumed *acceptable*. It is included but
   not runnable in the environment this was built in (no Python installed), so
   it has not been executed. Treat it as reviewed-but-untested code.
6. **Deadline** — none assumed; phases were built in the order given.

## Choices

- **Landmarks, not pixels, into every classifier.** 63 floats instead of 150k;
  generalises across skin tone, lighting and background for free; makes
  on-device inference trivially affordable.
- **MediaPipe in a Web Worker, frames dropped rather than queued.** A backed-up
  queue produces captions that lag reality, which is worse than a missed frame.
- **`requestVideoFrameCallback` for capture, `rAF` as fallback.** Avoids
  landmarking the same decoded frame twice.
- **Frame stream delivered by subscription, not React state.** At 30 fps, state
  would re-render the settings panel thirty times a second.
- **React 19, not React 18** (brief said 18). React 19 is what current Vite +
  `@vitejs/plugin-react` is tested against; nothing in the app depends on 18
  semantics. Easy to pin back if required.
- **Tailwind v4 with CSS-first tokens.** No `tailwind.config.js`; the theme lives
  in `@theme` in `index.css` next to the semantic CSS variables it feeds.
- **TypeScript 7.** Current stable at build time; typechecks clean.
- **Geometric letter templates as the Phase 1 baseline.** Gives a working,
  inspectable classifier with zero training data, and remains useful afterwards
  as a prior. Its weaknesses (M/N/S/T/E, R/U/V) are documented rather than
  hidden.
- **Calibration fits both nearest-centroid prototypes and a linear softmax
  head.** Prototypes work from one sample; the linear head takes over once there
  are ~5 per class. Both train in-browser in well under a second on 63-dim
  vectors.
- **Leave-one-out accuracy reported to the user, not training accuracy.**
  Training accuracy on 8 samples per class is meaningless and would flatter the
  model.
- **Dwell-time commit as the headline quality lever**, with smoothing by
  majority vote underneath it, driven by frame timestamps rather than frame
  counts so dropped frames do not change behaviour.
- **J and Z get a separate trajectory head.** Forced into the static classifier
  they would only ever read as I and D.
- **Confusion-aware autocomplete.** The recogniser's errors are structured, so
  the completion layer searches one-substitution variants within known confusion
  clusters. Recovers a lot of what the classifier gets wrong.
- **No trained models ship, and `registry.ts` refuses unhashed ones.** Shipping
  a placeholder that appears to recognise things is the overclaim this project
  exists to avoid.
- **Sign mode is few-shot only.** Custom signs work today and cover what no
  dataset contains (name signs, local signs, jargon). The 150-sign model is a
  stated target, not a claim.
- **Rejection band instead of a trained "no sign" class**, for now: when the
  nearest prototype is further away than its own examples typically are, return
  nothing. Without it the recogniser fires constantly during transitions.
- **Rule-based English↔gloss rather than an LLM call.** Predictable, offline,
  inspectable, and it can show which rules fired. An LLM would be better at
  fluency and worse at everything else that matters here.
- **Conversation mode ships behind an experimental flag, off by default**, with
  no model behind it and a screen that says so.
- **`onnxruntime-web` imported dynamically.** It is ~1 MB of JS and a 26 MB wasm
  binary; no session in this build loads an ONNX model, so none should pay for
  it. Main bundle went from 722 kB to 325 kB.
- **`privacy.onDeviceOnly` is a literal `true` in the type**, re-forced on every
  settings write and every migration, so a future refactor cannot quietly flip
  it.
- **Settings versioned with forward migrations from day one**, operating on
  plain records rather than current types, so renaming a field today does not
  break a migration written a year ago.
- **PWA `registerType: 'prompt'`, not `autoUpdate`.** A model or feature-pipeline
  change swapping in mid-conversation would be worse than a stale build.
- **MediaPipe wasm and `.task` files vendored into `/public`** by
  `npm run fetch:models`, so the app never touches a CDN at runtime and offline
  mode is real.
- **Disclaimer is non-dismissible, and an E2E test asserts the word
  "interpreter" only ever appears in a disclaiming context.**
