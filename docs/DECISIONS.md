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

## Found by looking at the running app

Two things that typechecked, passed unit tests, and were still broken. Both were
caught by screenshotting the built app against a fake camera device.

- **`FilesetResolver.forVisionTasks(path, true)`** — the `useModule` flag is
  required because Vite builds the vision worker as an ES module, where
  `importScripts` does not exist. Without it MediaPipe loads its classic-script
  runtime, never installs its factory, and every frame dies with
  "ModuleFactory not set". Nothing in the type system catches this.
- **Chrome over live video keeps the dark treatment in every theme**
  (`.sb-on-video`). In light theme, dark caption text sat on the dark scrim that
  makes hands readable, and was invisible. The scrim cannot lighten without
  washing out the hands, so the chrome adapts instead of the video.

Also fixed in the same pass: captions were rendering underneath the control bar
at the bottom edge; the settings toggle knob rendered outside its track (an
absolutely positioned span with no `left` inherits the button's centred text
alignment as its static position); and the settings close button's `aria-label`
did not contain its visible label, which is a WCAG 2.5.3 failure.

## Making Signs mode work without training

The brief's Phase 2 assumed a trained model on a licensed dataset. Asked to make
sign recognition work with no training at all, the answer was to do for whole
signs what `letterTemplates.ts` already does for the manual alphabet: write the
geometry down.

- **29 built-in signs as rules** (`signTemplates.ts`). Chosen for signs that are
  common *and* geometrically separable from each other. Signs differing only by a
  handshape the camera cannot resolve are deliberately absent — including them
  would mean guessing.
- **A sign is described as handshape + location + movement.** `observation.ts`
  summarises a window into named quantities ("flat hand", "at the chin", "moved
  outward", "tapped twice") so a rule reads like a description of the sign.
- **Location is measured from the shoulders, in shoulder-widths.** Location is
  phonemic in ASL, and it has to survive the signer sitting closer to the camera.
- **The scene is mirrored for right-handed signers**, so `+x` always means
  "outward on the dominant side" and every rule is written once.
- **User recordings outrank the rules.** A prototype recorded by this signer, in
  this room, with this camera beats a general rule almost every time.

### Two scoring bugs found by measuring, not by reading

Both were found by dumping raw template scores for idle poses rather than only
testing the positive cases — the tests that now pin them were written afterwards.

1. **A handshape is a conjunction, not an average.** Averaging clauses let a
   wrong thumb hide behind four correct fingers: a relaxed, half-open hand scored
   a perfect 1.0 as a C, so a hand resting near the face read as DRINK at 90%
   confidence. `handshapes.ts` now scores the worst-satisfied clause.
2. **A sign is never more certain than its handshape.** Even with (1) fixed, a
   weak handshape hid behind clauses that are trivially true ("one hand, near the
   face"). Every template now passes through `gated()`, which caps the score at
   the handshape score and counts the weakest remaining clause twice.

With both in place the measured separation is: idle and resting poses top out at
**0.40**, real signs score **1.00**. `REJECTION_FLOOR` is set to **0.55** — chosen
from those measurements to sit clearly between them, and pinned by a test that
fails if the margin closes from either side.

## Safari: "ReferenceError: Can't find variable: document"

Reported from a real device. MediaPipe decides for itself whether to trust
OffscreenCanvas:

```js
function Ph() {
  return typeof OffscreenCanvas !== 'undefined'
    && (!isSafariAndNotChrome || safariVersion >= 17);
}
// and then, when no canvas was supplied:
canvas ?? (Ph() ? undefined : document.createElement('canvas'))
```

On Safari 16 and earlier that check fails, so it reaches for `document`, which
does not exist inside a Web Worker. The whole pipeline died at startup.

Two fixes, because one is not enough:

- **Always pass an explicit canvas.** `landmarkerCore.ts` requires it as a
  parameter rather than accepting undefined, so the `document` branch is never
  reachable on any browser. This alone fixes Safari 16.
- **Fall back to the main thread.** Where `OffscreenCanvas` does not exist at
  all there is no canvas to hand a worker, so `VisionClient` transparently
  switches to `InlineLandmarker`, which runs MediaPipe on the main thread where
  `document` does exist. Capped at 20 fps because it now competes with
  rendering. The debug panel reports which path is live and says the captions
  will be choppier — a silent 10 fps drop is worse than an explained one.

MediaPipe handling moved into `landmarkerCore.ts` so the worker and the inline
runner cannot drift apart.

Also: raw errors no longer reach the UI. `describeVisionError()` maps the known
failures to something actionable — "Hand tracking could not start in this
browser. Update to the latest version, or try Chrome or Edge." A stack-trace
string is a true statement about our code and a useless one to somebody standing
in front of a camera.

`tests/e2e/fallback.spec.ts` simulates the browser by deleting OffscreenCanvas
before load, and asserts the app reaches the main-thread path with no
ReferenceError anywhere in the page or the console.

## The stale service worker: a shipped fix that could not reach anyone

After the Safari fix went out, the crash was still reported — with the *old*
wording in the error text. The fix had shipped; the browser was still running
the previous bundle, because the service worker was serving it and reloading
just handed back the same cache.

The cause was this, in `main.tsx`:

```ts
onNeedRefresh() {
  console.info('A new version of SignBridge is ready. Reload to use it.');
}
```

`registerType: 'prompt'` was the right call — swapping the model or the feature
pipeline under a live session would be worse than a stale build. Prompting into
the console was not. **A silent update mechanism is indistinguishable from a
broken one**, and from the outside it looks like the bug was simply never fixed.

Now:

- `UpdatePrompt` is a visible banner with a Reload button. Updates still never
  apply under a running session; the user decides when.
- Dismissing is allowed, and a *further* update clears the dismissal — otherwise
  one "Later" silences every future fix for the life of the tab.
- The registration polls every 15 minutes and again whenever the tab returns to
  the foreground, so a long-lived tab learns that a fix shipped.
- `cleanupOutdatedCaches: true`, so superseded precaches do not accumulate.
- **Settings → About → "Reload the app from scratch"** unregisters every service
  worker, deletes every cache and reloads. This is the escape hatch that did not
  exist at the moment it was needed.

Lesson worth keeping: an offline cache is a way to ship a permanent bug. Any
update path has to be visible, testable, and have a manual override.

## Lag, desync, and "ModuleFactory not set" on switching mode

Three separate reports from one device, three different causes.

### "Hand tracking could not start: ModuleFactory not set" when opening Signs

Signs mode needs pose, so switching to it called `reconfigure({trackPose: true})`,
and the worker's `configure` handler rebuilt the landmarker from scratch —
including a second `FilesetResolver.forVisionTasks()`. Safari does not survive a
second WASM instance in the same worker.

The fileset is now created once per thread and cached, and `Landmarker.update()`
changes options in place: `setOptions()` for the hand model, and pose created
lazily the first time it is needed and then kept. Nothing is ever torn down to
change a setting. This also stopped mode switches dropping a frame of tracking
state.

The fallback to the main thread now fires on *any* fatal worker error, not only
one during startup. A worker that dies when the user switches mode previously
left them with a dead camera and an error message.

### Laggy

Inference was being fed full 720p frames. MediaPipe's hand model works at
192x192 internally, so every pixel above that was spent on the copy and the
texture upload rather than on accuracy. Frames are now downscaled to 480px wide
(640 with pose) before inference — landmarks come back normalized, so they still
map onto the full-resolution video exactly. This is the single largest lever in
the pipeline.

The capture loop also paces itself to measured inference cost now. Requesting
frames faster than they can be processed produces no extra captions — the extras
are dropped having already cost a copy — and widens the gap between what the
camera shows and what the overlay draws.

### Out of sync

Distinct from lag, and it survives any frame rate. A landmark frame describes
where the hand was when it was *captured*, one inference ago; the video shows
now. Drawing the raw positions paints the skeleton where the hand used to be.

The overlay now redraws on every animation frame rather than on every landmark
frame — landmarks arrive at 15-30fps, the display refreshes at 60 — and
extrapolates each landmark along its measured velocity to where it should be
*now*. Capped at 120ms and damped to 0.75, because extrapolation amplifies noise
and a skeleton that overshoots is worse than one slightly behind.

## Mobile

The layout was designed at desktop width and had never been looked at on a
phone. On a 390px screen the disclaimer ran under the Debug and Settings
buttons, the mode rail occupied a third of the height, captions were set in
fixed 56px type, and the Signs and Debug panels covered the camera.

- Top chrome is one flex column on phones — disclaimer, then a row of mode chips
  with icon-only utilities. The left rail and the top-right buttons return at
  `sm`. Both are rendered from one `ModeButtons`/`UtilityButtons` definition so
  the two layouts cannot drift.
- Captions use `min(size, 9vw)`. A fixed pixel size is a desktop assumption.
- The disclaimer keeps the non-negotiable half on narrow screens and drops the
  enumeration, which needed three lines; the full text is in Settings > About.
- Icon-only buttons get 44px touch targets.
- The mode buttons' `aria-label` includes the visible text (`Reverse — Text→ASL`)
  rather than replacing it — the WCAG 2.5.3 failure fixed once already in
  Settings and immediately reintroduced here.

## Making signs better

Three changes, in descending order of how much they matter.

### Segmentation is learned, not fixed

This mattered more than any template change. Everything downstream — handshape,
location, direction of travel — is computed over the window the segmenter
produces, so a window that starts halfway through a sign or runs into the next
one produces garbage no rule can rescue.

The old thresholds were constants in normalized landmark units, which sounds
device-independent and is not: the scale depends on how much of the frame the
signer fills, how noisy the landmarks are in the current light, and how much the
person moves at rest. The segmenter now watches quiet periods, learns what
"still" looks like on *this* setup, and triggers on a real departure from it,
with hysteresis so it does not flicker at the boundary. It refuses to fire at
all until it has seen enough quiet to trust the floor.

It also requires a hand in frame, ends the window the moment the hand leaves,
trims the trailing settle (which otherwise drags the "where did it end up"
measurements toward wherever the hand dropped), and rejects windows whose peak
never really cleared the bar — a hand being repositioned rather than a sign.

### Corrections are training data

When the user says "that was actually THANK-YOU", the window that produced the
wrong guess is one perfectly labelled example of THANK-YOU as *they* sign it, in
this room, with this camera. It now gets folded into their custom prototypes
automatically. Since personal prototypes already outrank the built-in rules, a
single correction has visible effect, and the recogniser improves through use
rather than only through an explicit recording session.

Kept to the last 16 examples per sign, so an old attempt at a sign since refined
does not keep dragging the prototype backwards.

### A margin, not just a threshold

Confidence alone was not enough. HELLO and THANK-YOU can both score 0.8 on the
same window, which means the evidence does not separate them — not that the
higher one is right. Committing it would be a coin toss reported as certainty.
The winner now has to beat the runner-up by a margin, and when it does not the
UI says "HELLO or THANK-YOU — too close to call".

## Making mobile good, not just unbroken

The previous pass stopped things overlapping. This one is about the device.

**You cannot hold a phone and sign at the same time.** Signing needs both hands,
so the phone gets propped up and looked at from a distance. That reframes the
whole screen: controls matter when you pick it up, and are in the way the rest
of the time. Tapping the camera view now clears the chrome entirely. The
disclaimer stays — "clearing the chrome" is not an exception to non-dismissible.

Hidden chrome uses `visibility: hidden`, not just `opacity: 0`. An
opacity-0 control is invisible to sighted users and still in the tab order and
the accessibility tree, which is worse than either state.

**Layout follows height, not just width.** A phone in landscape is 844px wide
and 390px tall, so width-based breakpoints handed it the full desktop layout in
a viewport with no room: the disclaimer ran under the utility buttons and the
mode rail overlapped the captions. A `short` variant (`max-height: 540px`) now
switches to the compact chrome regardless of width.

Also: safe-area insets on full-height panels, so the Settings title clears the
notch and the last row clears the home indicator.

## Round three: still laggy, signs still bad, too many buttons

All three reports were right, and two of them were faults I had introduced.

### Fingerspelling was tracking a hand nobody read

`numHands` came from the `twoHanded` setting, which defaults on — so the default
mode asked MediaPipe to find two hands while `pickHand()` read exactly one. That
is roughly double the per-frame cost of the most-used mode, spent on nothing.
Hand count now follows the mode: one for fingerspelling, two only where
two-handed signs are actually possible.

### The signs rules had been tuned into silence

Three gates in series — the rejection floor (0.55), a margin over the runner-up
(0.12), and the user's confidence threshold (0.65) — all calibrated against
synthetic observations that score a clean 1.0. Real ones never do: MediaPipe's
handshapes are noisy and every clause lands a little short. The likely effect
was a mode that had gone from *sometimes wrong* to *always silent*, which is
indistinguishable from broken.

The deeper mistake was treating recognition as a yes/no decision when the
accuracy is unmeasured. It now **proposes**: the best candidate is always shown
with its score, and tapping it both writes it and files the window as a training
example. Auto-commit still needs confidence and a margin. So the floor's meaning
changed — it gates whether a guess is *offered*, not whether it is written — and
it moved down to 0.45 accordingly.

This is the honest shape for a recogniser that cannot state its own accuracy:
offer, let the person decide, and learn from the decision.

### The only feedback in Signs mode was desktop-only

The status panel was `hidden sm:block`. On a phone, an unrecognised sign
produced nothing at all — no guess, no reason, no hint that anything had
happened. There is now one status bar at every screen size showing what it saw
and how sure it was.

### Too many buttons

Thirteen controls on a 390px screen. Now eight:

- Secondary actions (fix, read aloud, export, clear) collapse behind **More** on
  phones; there is room for all six on a wide screen, so the overflow only
  exists where it earns its place.
- **Debug** is a diagnostic, not a primary action — desktop and the `D` shortcut
  only.
- The floating **What it knows** list is desktop-only; on a phone the same list
  lives inside the record sheet, where someone choosing what to record wants it,
  and tapping a sign there pre-fills the name.

## "I sign T or M and it writes A"

Correct, reproducible, and the most interesting failure in the project so far.

A, S, T, M, N and E are the same closed fist. The only thing that separates them
is where the thumb is — and in T, M and N the thumb is *underneath the fingers*,
which is to say invisible. MediaPipe does not measure a hidden thumb; it infers
one from the visible hand, and that inference is pulled toward the commonest
fist in its training data, which is an A.

**So the landmarks handed to the rules already say A.** No rule written over that
output can recover the difference, and the previous templates made it worse by
keying on `thumbDepth` — a quantity derived from MediaPipe's z channel, its least
reliable output, and least reliable precisely when the thumb is occluded.

Two changes:

**A 2D feature instead of a depth one.** `thumbAcross` measures where the thumb
tip sits along the knuckle line: 0 at the index knuckle, 1 at the pinky. A sits
beside the index, T pokes through between index and middle, N between middle and
ring, M past the ring. Ordering the cluster along one axis makes the rules
monotonic and testable, and it degrades gracefully rather than tracking a noisy
z. `tests/signs.test.ts` pins the A → T → N → M sweep.

That is a better rule over inferred data. It is not a fix, and it should not be
described as one.

**Corrections became training data.** This is the part that actually works. A
model fitted to what MediaPipe *reports* for this signer's T can separate it from
their A even when both look like an A to a rule — as long as the two outputs
differ consistently, which they generally do, because the visible fingers do
differ slightly. Tapping the right letter now files that frame as a labelled
sample, updates the nearest-centroid prototypes immediately, and refits the
linear head once there is enough data. A handful of corrections per letter is
usually enough.

The correction strip also had to change. It offered the second and third
guesses, but when the model is confident it saw an A, the letter you actually
signed may be fifth — and a correction you cannot reach is not a correction. It
now offers the whole confusion cluster whatever the scores say.

Noted for later: **facial landmarks for signs.** Non-manual markers — eyebrows,
mouth morphemes, head tilt — carry grammar the app currently cannot see at all.
FaceLandmarker is already vendored and the worker can enable it. Parked
deliberately; the alphabet should be solid first.

## Reading the hand better, and getting it on screen sooner

Two complaints, one round of work: letters and signs were read wrong too often,
and the tracked hand felt like it was trailing the real one.

### Handshape now comes from world landmarks

MediaPipe has been returning two versions of every hand all along and the app
was only reading one. `landmarks` is the projection onto the image; the
`worldLandmarks` set is metric, hand-centred, and free of perspective.

The rules are written in ratios of small distances — how much of a finger's arc
length is spanned by the straight line from knuckle to tip, how far the thumb
tip sits along the knuckle line — and a projection wrecks exactly those. A
finger pointing at the camera is foreshortened to almost nothing in x and y, so
an extended finger reads as a curled one; the z channel that would have
recovered its true length is a weakly-supervised depth offset in image units,
not a measurement. That is a large part of why D, L, G and the pointing letters
degraded the instant a hand turned off-axis, and it is fixed by reading the
coordinates that were already there.

`pointing` still comes from the image, because world space throws the camera
away and P, Q, G and H are distinguished by nothing except which way the hand
points in the frame. One function, `geometryOf()`, owns that split so there is
no second place for it to be decided differently.

**What did not change, deliberately:** the 63-float feature vector. It is the
space every stored calibration sample, every recorded custom sign and
`training/normalize.py` are expressed in. Moving it would have thrown away work
users had already put in, without telling them. Only the rules read world
coordinates; the learned path is untouched.

### The landmark stream is filtered before anything reads it

A 1€ filter (Casiez et al., CHI 2012) on every landmark channel. Its cutoff
frequency rises with the measured speed of the point, so a still hand is
filtered hard and a moving hand is barely filtered at all — which is the one
combination that helps here. A moving average would have bought the same
steadiness by adding the lag this work exists to remove.

It is an accuracy feature as much as a latency one. Jitter of a pixel or two on
a fingertip moves those small-distance ratios enough to flicker the classifier
between neighbouring letters, and every flicker restarts the dwell timer.

Exposed as **Hand steadiness** in settings, defaulting to standard. Existing
installs migrate to standard rather than to off: off is what they had, and it is
the worse experience. The setting is there so someone can *ask* for raw
tracking, not so they get it by accident.

### The main thread stops taking pictures nobody will look at

The worker already dropped a frame that arrived while it was busy. But by then
the main thread had paid for a full `createImageBitmap` — a GPU copy and a
synchronisation point — and thrown the result away. Several times a second, that
is exactly the kind of main-thread work that makes video stutter.

The client now tracks whether a frame is outstanding and does not take the
picture at all until the worker answers, with a one-second timeout so a lost
message cannot stall capture forever. The worker-side drop remains as a
backstop.

With real backpressure in place, the cost-based frame-rate backoff on the worker
path went away: it was guessing at a number the in-flight guard now knows
exactly, and guessing low only widens the gap between hand and caption. The
inline path keeps its backoff, because there inference really does cost
main-thread time.

There was also a rate-aliasing cliff worth naming. The capture gate tested
`elapsed >= interval` exactly, so whenever the computed interval crept just past
the camera's frame period — 34 ms against a 30 fps camera's 33.3 — every single
callback failed by a hair and capture halved to 15 fps, precisely when it could
least afford to. The gate now allows a quarter-interval of slack.

### The overlay was extrapolating from the wrong instant

It predicts forward along the measured velocity to cover the gap between when a
frame was captured and when it is drawn. It was measuring that gap from when the
frame *arrived back* on the main thread — which omits the inference and transfer
cost, i.e. the entire quantity being corrected for. Measuring from `frame.t`
closes it. Small change, and the most directly visible one in this batch.

### Letters commit on averaged evidence, not on votes

The smoothing window used to hold each frame's winning label and take a
majority. That throws away everything except the argmax, which is the wrong
thing to do in the fist cluster where the margins are a few hundredths: five
frames that each said "T at 0.34, A at 0.36" cast five votes for A and none for
T. The committer now averages the distributions across the window when the
caller supplies them, so near-ties stay visible and the frames that are actually
decisive settle the matter.

Frames with no hand count as zeros rather than being skipped, which gives the
"no sign" behaviour for free: a letter seen in two frames out of five cannot
average above 0.4 and never reaches the threshold. Hard-label voting is still
there for callers that have no distribution to give.

**None of this is a substitute for a trained model or for calibration.** It is a
better reading of the same evidence, and the honest per-letter numbers in the
debug panel still come from the user's own samples.
