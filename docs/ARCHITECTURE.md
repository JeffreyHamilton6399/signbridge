# Architecture

## The one decision everything else follows from

**Never send raw pixels to a classifier.** Extract landmarks first, normalize
them, then classify the numbers.

A 21-point hand landmark set is 63 floats. A 224×224 RGB crop is 150,528. The
landmark path is 50–100× cheaper, and — more importantly — it generalises across
skin tone, lighting, clothing, and background for free, because none of those
survive landmark extraction. It also keeps everything on-device: 63 floats per
frame is cheap enough that no cloud round-trip is ever tempting.

The cost is that anything landmarks throw away is gone. Facial expression,
eyebrow position, and mouth morphemes — grammar in ASL, not decoration — are only
partly recoverable, and only if face landmarks are enabled. This is a real
limitation and the UI says so rather than hiding it.

## Data flow

```
camera stream (MediaStream, main thread)
   │
   │  createImageBitmap(video)         transferable, zero-copy
   ▼
Web Worker  ── MediaPipe HandLandmarker (+ PoseLandmarker when needed)
   │            drops frames under load, never queues them
   │  21 points × 2 hands · 33 pose points
   ▼
normalize.ts   aspect-correct → mirror left→right → wrist to origin
   │           → scale by hand span → rotate to canonical roll
   │  63 floats, invariant to position, distance, roll, handedness
   ├──────────────┬─────────────────────┬──────────────────────┐
   ▼              ▼                     ▼                      ▼
fingerspell    signs                 conversation           reverse
single frame   64-frame window       continuous stream      (no camera)
   │           body-relative            │                    English
   │              │                     │                      │
geometric      few-shot              CTC decode             gloss engine
templates      nearest-centroid      → gloss seq            → gloss seq
   +              +                     │                      │
personal       rejection band        gloss→English          clips or
linear head    (= "no sign")         (rules)                fingerspell
   │              │                     │                      │
   ▼              ▼                     ▼                      ▼
   └──────── confidence gate → smoothing → dwell commit ───────┘
                                │
                        text buffer → captions → speechSynthesis
```

## Threading and the frame budget

Target: **under 150 ms from gesture to caption.** Measured end to end in the
debug panel; the CI latency benchmark fails the build above a p95 of 200 ms.

- Capture runs on `requestVideoFrameCallback` where available, so we only
  landmark frames the browser actually decoded. Firefox falls back to `rAF`.
- Landmark extraction runs in a worker. It is 8–20 ms of work; on the main
  thread it visibly janks both the video element and the commit animation.
- **Frames are dropped, never queued.** If the worker is busy the incoming
  `ImageBitmap` is closed and discarded. A queue would produce captions that lag
  reality, which is worse than missing a frame nobody would have noticed.
- Per-frame work on the main thread is deliberately tiny: normalization plus a
  24-template scoring pass, microseconds in total. React state is written only
  when something the user can see changes.

## Why the frame stream is not React state

At 30 fps, putting the landmark frame in a store would re-render the settings
panel thirty times a second. `PipelineProvider` exposes `subscribe(listener)`
instead; the overlay canvas and each mode attach to it directly. Only
user-visible transitions — a new tentative letter, a commit, a space — go through
zustand.

## Normalization contract

`src/features/normalize.ts` is the interface between the camera and every model.
Its output is what models are trained against, so a change there invalidates
every trained artefact. `tests/normalize.test.ts` pins the exact behaviour and
should be read as the specification.

Order matters:

1. **aspect correction** — image-normalized coordinates are stretched by the
   frame's aspect ratio; undoing that makes distances isotropic
2. **mirror** — left hands are reflected into right-hand space, so one model
   serves both dominant hands
3. **translate** — wrist becomes the origin
4. **scale** — divide by wrist→middle-MCP distance (the most articulation-stable
   segment on the hand), removing distance from camera
5. **rotate** — canonical roll, so a tilted hand matches an upright one

For sign-level features the hand *position* is kept separately, relative to the
shoulders, because location on and around the torso is phonemic: the same
handshape at the chin and at the chest are different signs.

## Repository layout

```
src/
  camera/      stream acquisition, device enumeration, error → remedy mapping
  vision/      worker, protocol, capture loop, landmark types
  features/    normalization, hand geometry, temporal windowing
  models/      ONNX loading, hash verification, backend probing
  modes/
    fingerspell/  templates, classifier, dwell commit, motion letters, calibration
    signs/        few-shot prototypes, segmenter, target vocabulary
    conversation/ CTC decode, gloss→English
    reverse/      gloss engine, clip dictionary, playback
  speech/      TTS and STT wrappers
  settings/    schema, defaults, versioned migration
  store/       zustand slices (settings, session)
  db/          IndexedDB — the only persistence in the app
  ui/          shell, captions, controls, panels, theme
```

## Where models come from

None ship. `public/models/manifest.json` is empty, and `registry.ts` refuses to
load anything whose SHA-256 does not match its manifest entry. The app runs on:

- **fingerspelling** — geometric templates, plus a linear head fitted in-browser
  from the user's own calibration samples
- **signs** — the user's own recorded prototypes
- **conversation** — nothing; the mode says so

This is deliberate. Shipping an untrained placeholder that appears to recognise
things is the exact overclaim this project exists to avoid. See `MODELS.md`.
