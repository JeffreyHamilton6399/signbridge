# MASTER PROMPT — "SignBridge": Real-Time ASL Recognition & Translation Web App

> **How to use this file:** Save it as `CLAUDE.md` in the root of an empty project folder, then start Claude Code in that folder and say: *"Read CLAUDE.md. Ask me the questions in Section 12, then start Phase 0."*
> Everything below is instructions to the AI agent building the app.

---

## 1. What you are building

A browser-based web app that uses the device camera to recognize American Sign Language and convert it to on-screen text and spoken audio — and, in the reverse direction, converts typed or spoken English into ASL output.

Four modes:

| Mode | Direction | Difficulty | Phase |
|---|---|---|---|
| **Fingerspell** | Hand → letters → words | Achievable | P1 |
| **Signs** | Hand+body → single-word glosses | Hard but doable | P2 |
| **Conversation** | Continuous signing → English sentences | Research-grade | P4 |
| **Reverse** | Text/speech → ASL video or avatar | Doable with caveats | P3 |

---

## 2. Read this before writing a single line of code

These constraints are not negotiable. Push back on me if I ask you to violate them.

**ASL is a language, not a code for English.** It has its own grammar, spatial syntax, and non-manual markers (facial expression, eyebrow position, head tilt, mouth morphemes). "Sign for each English word in order" is not ASL. Any sentence-level feature must include a gloss→English translation step, not a word swap.

**Do not overclaim.** This is a *recognition assistant*, not an interpreter. The UI must never imply it is safe for medical, legal, emergency, financial, or educational-accommodation use. Ship a persistent, non-dismissible disclaimer in those terms. Never use the word "interpreter" for the software.

**Video never leaves the device.** All landmark extraction and inference run client-side. No frames, no landmarks, no transcripts uploaded anywhere by default. If a cloud model is ever added, it must be opt-in with an explicit, plain-language consent screen. Say this loudly in the UI — it's the single best trust feature this app has.

**Deaf-led or don't ship.** Hearing-built ASL apps have a bad track record and a well-earned reputation problem in the Deaf community. Build in an obvious feedback path, credit data sources and Deaf consultants, and flag to me (the user) that recruiting Deaf testers before launch is a requirement, not a nice-to-have.

**Confidence is a first-class UI element.** Never display a recognized word as if it were certain. Show confidence visually. Show the top-3 alternates. Make correction one tap.

---

## 3. Tech stack

Use these unless you have a concrete reason to deviate — if you do, tell me first.

```
Frontend      Vite + React 18 + TypeScript
Styling       Tailwind CSS
State         Zustand (light, no Redux)
Vision        @mediapipe/tasks-vision  (HandLandmarker, PoseLandmarker, FaceLandmarker)
Inference     onnxruntime-web  (WASM + WebGL/WebGPU backends)
Speech out    Web Speech API — speechSynthesis
Speech in     Web Speech API — SpeechRecognition (Chrome/Edge), Whisper-web fallback
Storage       IndexedDB via idb  (settings, transcripts, custom signs)
Offline       Vite PWA plugin, models cached via Cache API
Training      Separate /training dir — Python 3.11, PyTorch, export to ONNX
Testing       Vitest + React Testing Library, Playwright for camera-mocked E2E
```

**Verify current APIs before using them.** MediaPipe Tasks Vision and onnxruntime-web change their APIs between minor versions. Check the current docs rather than relying on memory, and pin exact versions in `package.json`.

---

## 4. Architecture

The core insight: **never send raw pixels to the classifier.** Extract landmarks first, normalize them, then classify. This is 50–100× cheaper, generalizes across skin tone, lighting, clothing, and background, and keeps everything on-device.

```
Camera stream
   ↓
MediaPipe landmarker (runs in a Web Worker, ~30fps)
   ↓  21 hand points × 2 hands, 33 pose points, optional 478 face points
Normalizer  →  translate to wrist origin, scale by hand span,
                rotate to canonical orientation, mirror if left-handed
   ↓
Ring buffer (rolling window of N frames)
   ↓
┌─ Fingerspell:  single-frame MLP + dwell-time debouncer
├─ Signs:        64-frame window → temporal model (GRU or small Transformer)
└─ Conversation: continuous stream → CTC decoder → gloss sequence → LLM translate
   ↓
Confidence gate + smoothing
   ↓
Text buffer  →  UI captions  →  speechSynthesis
```

### Repo structure

```
/src
  /camera        stream setup, device enumeration, permissions, mirror
  /vision        worker wrapper for MediaPipe, landmark types
  /features      normalization, windowing, feature vector builders
  /models        ONNX loading, warmup, backend selection, inference
  /modes         fingerspell/  signs/  conversation/  reverse/
  /speech        TTS wrapper, STT wrapper, voice management
  /settings      schema, defaults, persistence, migration
  /ui            components, captions, confidence bar, correction sheet
  /store         zustand slices
/public/models   *.onnx + label maps (versioned, hash-checked)
/training        Python — data prep, train, eval, export, model cards
/docs            ARCHITECTURE.md, MODELS.md, ACCESSIBILITY.md, ETHICS.md
```

**Performance budget:** end-to-end latency under 150ms from gesture to caption. Landmark extraction and inference both run off the main thread. Drop frames rather than queue them — a backed-up queue produces captions that lag reality, which is worse than missing frames.

---

## 5. Phased build plan

Do not start a phase until the previous one meets its acceptance criteria. Show me the app at every phase gate.

### Phase 0 — Shell
Vite app, camera permission flow with a clear pre-permission explainer, device picker, mirror toggle, MediaPipe hand landmarks rendering as an overlay at ≥24fps. Settings persistence. Dark/light. Nothing recognizes anything yet.

**Done when:** landmarks track my hand smoothly on desktop Chrome and mobile Safari, and the app survives a camera unplug/replug.

### Phase 1 — Fingerspelling
26 letters. Static poses via a small MLP on normalized landmarks; J and Z need a 12-frame motion window, so treat them as a separate tiny temporal head.

Key mechanics:
- **Dwell-time commit** — a letter only commits after being held above threshold for a configurable duration (default 600ms). This is the single biggest quality lever; make it prominent in settings.
- **Auto-space** — hand leaves frame or rests below a position threshold for the gap duration → insert space.
- **Word prediction** — as letters accumulate, offer top-3 dictionary completions, tappable. Fingerspelling recognition is error-prone; a good autocomplete layer covers a lot of model weakness.
- **Backspace gesture** and an always-visible manual backspace.

Build a **calibration flow**: have the user record 5–10 samples of each letter on first run, fine-tune the last layer locally. Personalization dramatically outperforms a generic model, and it runs in-browser in seconds since you're training on 63-dim vectors, not images.

**Done when:** ≥90% letter accuracy for a calibrated user in decent lighting, with the caveat that M/N/S/T/E and R/U/V are the known confusion clusters — report per-letter accuracy honestly in a debug panel.

### Phase 2 — Word signs
Scope tightly: **100–250 high-frequency signs**, not 2000. A 150-sign vocabulary at 85% accuracy is a usable product; a 2000-sign vocabulary at 45% is a demo that frustrates people.

Model: 64-frame window of concatenated hand + upper-body pose landmarks → bidirectional GRU or 4-layer Transformer encoder → softmax. Add a "no sign / transition" class — it's essential and usually forgotten.

Include **custom sign recording**: user records 8 samples of a sign, app trains a local prototype (few-shot, nearest-centroid in embedding space works well), stored in IndexedDB. This lets people add names, local signs, and jargon.

**Done when:** ≥80% top-1 on a held-out signer for the chosen vocabulary, and the "no sign" class prevents spurious firing when the user is just moving around.

### Phase 3 — Reverse direction (text/speech → ASL)
English input (typed or via speech recognition) → ASL gloss sequence → visual output.

Two output options; **build the clip-based one first**:
- **Clip dictionary** — pre-recorded video of each sign, stitched with crossfades. Honest, high-quality handshapes, but choppy and can't express spatial grammar. Needs licensed or self-recorded footage.
- **3D avatar** — smoother and more flexible, but there is no open, production-quality ASL avatar available. Anything you build here will look uncanny and will be criticized. Treat as experimental and label it as such.

The English→gloss step must be a real translation (drop articles/copulas, move time markers to sentence-initial position, apply topic-comment structure), not a dictionary lookup per word. A small LLM call or a rule-based gloss engine both work; the rule engine is more predictable and runs offline.

**Done when:** a 5-word sentence renders as a coherent clip sequence with correct ASL word order, and the UI clearly marks this as an approximation.

### Phase 4 — Continuous conversation (experimental)
Be honest with me: continuous ASL recognition is an open research problem. Sentence-level ASL translation systems in the literature score well below usable accuracy on unconstrained input.

Approach: CTC head over the temporal encoder producing a gloss sequence, then gloss→English via a language model. Ship behind an "Experimental" flag, off by default, with visible accuracy expectations.

**Done when:** it works on short, clear, in-vocabulary sentences and *fails visibly rather than confidently* on everything else.

### Phase 5 — Polish
PWA install, offline models, transcript export (txt/srt), session history, keyboard shortcuts, onboarding tutorial, model cards in `/docs`.

---

## 6. Settings — full spec

Build a typed settings schema with versioning and migration from day one. Group as follows:

**Recognition**
- Mode: Fingerspell / Signs / Conversation / Reverse
- Dominant hand: Right / Left / Auto-detect
- Two-handed signs: on/off
- Confidence threshold: slider, 0.3–0.95, default 0.65
- Dwell time to commit: 200–1500ms, default 600ms
- Auto-space gap: 400–2000ms, default 900ms
- Smoothing window: 1–15 frames
- Run calibration / Reset calibration
- Manage custom signs

**Camera**
- Device selector, resolution, target FPS
- Mirror preview: on/off (default on — it's what people expect)
- Landmark overlay: off / hands / hands+pose / debug (with per-class confidences)
- Framing guide overlay: on/off

**Speech output**
- Read aloud: off / per letter / per word / per sentence
- Voice picker, rate 0.5–2.0, pitch, volume
- Speak only above confidence threshold: on/off
- Punctuation inference: on/off

**Speech input** (Reverse mode)
- Mic device, language, push-to-talk vs continuous, interim results on/off

**Display**
- Caption size: S/M/L/XL/Huge
- Caption position: bottom / top / side panel
- Font: system / OpenDyslexic / high-legibility
- Theme: light / dark / high contrast / system
- Show confidence bar: on/off
- Show top-3 alternates: on/off
- Reduced motion: on/off (also respect `prefers-reduced-motion`)

**Performance**
- Inference backend: auto / WebGPU / WebGL / WASM
- Power saving mode (halves FPS)
- Model precision: full / quantized

**Privacy & data**
- On-device only: locked on, with explainer
- Save transcripts locally: on/off
- Auto-delete transcripts after N days
- Export all data / Delete all data

**Accessibility**
- Full keyboard navigation, visible focus rings
- Screen reader labels on every control
- Haptic feedback on commit (mobile)
- Audio cue on commit: on/off

---

## 7. UI direction

Design the interface around one idea: **the camera view is the document.** Captions are not a chat log below a video — they are typography laid over live video, the way subtitles live on film.

Guidance:
- The signing hand is the subject; keep chrome minimal and out of the frame's center-bottom where hands actually are. Controls belong at the extreme edges or behind a gesture.
- Confidence should be encoded in the *typography itself* — a letter still being formed renders lighter/thinner and firms up as it commits. This makes the model's uncertainty legible without adding a widget.
- Pick a display face with real character for the captions and a clean utility face for controls. Captions are read at a glance, often at distance, often by someone with low vision — legibility at large sizes and high contrast beats fashion here, but that's a constraint to design *within*, not a reason to default to system-ui.
- One signature moment, executed well. Suggest: the commit animation — the transition from tentative to committed letter. It happens hundreds of times per session, so it's the thing people will remember.
- Avoid: cream background + serif + terracotta accent; near-black + acid green; generic 01/02/03 numbered sections. These read as templated.

Copy rules: active voice, sentence case, name things by what the user controls. The button says "Read aloud," the toast says "Reading aloud." Errors state what happened and how to fix it — "Camera is in use by another app. Close it and tap Retry," not "An error occurred."

---

## 8. Data & models

Put a **model card** in `/docs/MODELS.md` for every shipped model: training data, signer demographics, known failure modes, per-class accuracy, license.

Candidate datasets — **verify current availability and license terms yourself before using any of them**:

- **ASL Citizen** (Microsoft Research) — isolated signs, large, collected with participant consent. Generally the best-documented starting point for Phase 2.
- **WLASL** — ~2000 glosses, web-scraped; widely used in papers but the provenance and licensing are murky. Read the terms before shipping anything trained on it.
- **MS-ASL** — YouTube-sourced, link rot is a known problem.
- **ChicagoFSWild / FSWild+** — fingerspelling in natural video, relevant to Phase 1.
- **How2Sign**, **OpenASL** — continuous ASL with English alignment, relevant to Phase 4.

For Phase 1, **recording your own fingerspelling landmark data is often better than any public dataset** — you need 63 floats per sample, so a few thousand samples across several people is an afternoon of work and matches your exact preprocessing pipeline.

Evaluate on **held-out signers**, never held-out clips. Random splits leak signer identity and inflate accuracy dramatically. Report accuracy broken down by signer skin tone, handedness, and lighting condition; if you can't, say so in the model card.

---

## 9. Testing

- Unit tests for normalization math — these are pure functions and must be exact.
- Golden-file tests: recorded landmark sequences → expected labels, so model swaps are regression-checked.
- Playwright E2E with a mocked camera feeding fixture video.
- Manual test matrix: Chrome/Edge/Safari/Firefox, desktop + mobile, front + rear camera, bright/dim/backlit, long sleeves/short sleeves, multiple skin tones.
- Latency benchmark in CI; fail the build if p95 exceeds 200ms.

---

## 10. How you should work with me

- Ask before choosing anything with long-term cost: library swaps, model architecture, data sources, anything that touches privacy.
- At each phase gate, stop and show me a working build plus a short note on what's weak.
- When accuracy is bad, tell me it's bad and why. Do not tune the confidence threshold down to make demos look better.
- Keep a running `/docs/DECISIONS.md` — one line per significant choice and its reason.
- Prefer deleting a feature over shipping one that misleads a user about what the app can do.

---

## 11. Explicit non-goals

Not building: a sign language teaching/quiz app, a cloud API, user accounts, multi-user rooms, other sign languages (BSL/Auslan/LSF are entirely different languages — do not claim support), or anything positioned as a replacement for a certified interpreter.

---

## 12. Ask me these before you start

1. Do I have access to Deaf signers for data collection and testing, or should Phase 1 rely on my own recordings plus public datasets?
2. What's my target vocabulary for Phase 2 — do I have a word list, or should you propose 150 high-frequency signs?
3. Desktop-first or mobile-first? (This changes the camera and layout work substantially.)
4. For Reverse mode: do I have or can I license sign video clips, or should you scope that phase to a small self-recorded set?
5. Am I comfortable with a `/training` Python pipeline, or does everything need to stay in TypeScript?
6. Any deadline or demo date that should change the phase ordering?

Then start Phase 0.
