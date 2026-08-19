# SignBridge

A browser-based American Sign Language **recognition assistant**. It watches your
camera, guesses at handshapes, and turns them into text and speech. In the other
direction it turns typed or spoken English into an ASL gloss and plays it back.

**Everything runs on your device.** No frames, no landmarks, no transcripts are
uploaded. There is no server.

> **This is not an interpreter.** It is not safe for medical, legal, emergency,
> financial, or educational-accommodation conversations. A certified interpreter
> conveys meaning, register and intent between two languages and two cultures.
> This app does pattern matching on hand positions. Read
> [`docs/ETHICS.md`](docs/ETHICS.md) before doing anything with it.

---

## Quick start

```bash
npm install          # also vendors the MediaPipe wasm + models into /public
npm run dev          # http://localhost:5173
```

The camera needs a secure context, so `localhost` or `https` only.

```bash
npm test             # 97 unit tests
npm run typecheck
npm run build
npm run e2e          # Playwright, against a fake camera device
```

---

## What actually works today

| Mode | State | What it does |
|---|---|---|
| **Fingerspell** | Working | 24 static letters from geometric templates, plus J and Z from a trajectory head. Gets substantially better after calibration. |
| **Signs** | Working, user-taught | Recognises signs *you* record — name signs, local signs, jargon. No general sign model ships. |
| **Reverse** | Working | Real English→ASL gloss translation with rule explanations. Fingerspells everything, since no clips ship. |
| **Conversation** | Not working, and says so | The CTC decoder and feature pipeline exist; there is no trained model, and continuous ASL recognition is an open research problem. Off by default. |

### Why no trained models ship

`public/models/manifest.json` is empty and the loader refuses anything whose
SHA-256 does not match its manifest entry. Bundling an untrained placeholder
that appears to recognise things is the exact overclaim this project is built to
avoid. See [`docs/MODELS.md`](docs/MODELS.md) for the card template, the dataset
notes, and the held-out-signer evaluation rules; [`training/`](training/) has
the pipeline for producing one.

### Calibration is the feature that matters

Record 8 samples of each letter — about four minutes — and the app fits a
classifier to your hands, your sleeves and your camera, in the browser, in under
a second. A model that only has to cover *you* beats a general one by a wide
margin. Settings → Recognition → Calibration.

It reports **leave-one-out** accuracy, not training accuracy, because training
accuracy on 8 samples per class is meaningless and would flatter the model.

---

## How it works

The one decision everything follows from: **never send raw pixels to a
classifier.** Extract 21 hand landmarks first, normalize them, classify the
numbers. 63 floats instead of 150,528 — 50–100× cheaper, generalises across skin
tone, lighting and background for free, and makes on-device inference trivially
affordable.

```
camera → worker (MediaPipe, drops frames rather than queueing)
       → normalize (wrist origin, unit hand span, canonical roll, mirrored)
       → classify → smooth → dwell-commit → captions → speech
```

Full detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

**Performance budget:** under 150 ms gesture to caption, shown live in the debug
panel (press `D`).

---

## Keyboard

| Key | Action |
|---|---|
| `Space` | Commit the current word |
| `Backspace` | Delete a letter, or pull the last word back to edit |
| `F` | Fix the last word |
| `R` | Read aloud |
| `E` | Export the transcript |
| `D` | Debug panel |
| `,` | Settings |

---

## Deploying

Static build; any host works. `vercel.json` is included and sets the
cross-origin isolation headers (for multi-threaded wasm), long-lived caching for
model assets, and a camera-scoped `Permissions-Policy`.

```bash
npm run build   # -> dist/
```

`postinstall` vendors the MediaPipe wasm and `.task` files into `public/`, so
they exist on the build machine without being committed. If that ever fails, the
worker falls back to the MediaPipe CDN at runtime — the app keeps working, but
offline mode does not.

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — data flow, threading, the normalization contract
- [`docs/MODELS.md`](docs/MODELS.md) — model cards, datasets, evaluation rules
- [`docs/ETHICS.md`](docs/ETHICS.md) — what this must never claim, and why
- [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md) — what is implemented, and what is not
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — every significant choice and its reason
- [`training/README.md`](training/README.md) — the offline pipeline

---

## Before this goes in front of anyone

Not a wishlist — a blocker list, from [`docs/ETHICS.md`](docs/ETHICS.md):

- [ ] Deaf signers testing it, compensated, with their feedback visibly changing the product
- [ ] Deaf review of the 150-sign target vocabulary (regional variation is real)
- [ ] Credited data sources and consultants
- [ ] A feedback path that goes somewhere real and gets read
- [ ] Screen reader and braille display testing with actual users

Built by a hearing developer. That is a known problem, stated plainly, not a
footnote.

---

## Not in scope

A teaching or quiz app · a cloud API · user accounts · multi-user rooms · other
sign languages (BSL, Auslan and LSF are separate languages, not dialects) ·
anything positioned as a replacement for a certified interpreter.
