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

- **Built-in signs as rules** (`signTemplates.ts`), 29 at first and 97 now. Chosen for signs that are
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

## Making the scan itself better

The previous round improved what happens *after* a frame arrives. This one is
about the frame.

### Hands now have an identity

MediaPipe reports each frame independently. It hands you a list of hands and a
Left/Right label per hand, and promises neither that the hand at index 0 this
frame is the hand that was at index 0 last frame, nor that the label is the
same. Both change in practice — the label flips on rotation, near the frame
edge, and when the hands cross — and three separate consumers had quietly
assumed otherwise:

- the 1€ filter keyed its state on the handedness label, so every flip threw
  away the filter history and let a frame of raw jitter through to the classifier
- the overlay declined to extrapolate when labels disagreed between frames, so a
  flip showed up as the skeleton stalling
- `pickHand` in auto mode took whichever hand had the higher handedness score,
  which can swap mid-word

`vision/tracking.ts` establishes identity once, before anything else looks at a
frame. Hands are matched to the previous frame by wrist position — they cannot
move far in 33ms — and each track accumulates its own evidence about which
physical hand it is. The reported label is that accumulated verdict, not this
frame's guess, weighted by how sure the detector was, which is what stops it
flickering. A hand that teleports across the frame, or reappears after being
gone, gets a new id rather than a track being stretched to reach it.

The reported `handednessScore` changed meaning: it is now how settled the
verdict is, not how sure one frame was. A hand whose label has been flip-flopping
should not claim 98%.

### The app says when it cannot see, instead of guessing

Most recognition failures are not model failures. The hand is half out of frame,
or far away, or turned edge-on so the fingers occlude each other, or moving too
fast to be anything but a smear. In every one of those cases MediaPipe still
produces 21 confident-looking landmarks — several of them extrapolated past the
frame edge — and the classifier still returns its best guess, with a confidence
that knows nothing about any of it.

`features/scanQuality.ts` measures the input rather than the output: hand span
against frame height, landmarks outside the frame, wrist speed in hand spans per
second, and how edge-on the palm is. It never consults what the classifier said,
because a check that reads the answer it is meant to be checking is not a check.

When the view is unusable, fingerspelling feeds the committer a null label and
resets the motion buffer. No auto-space — the hand is still up, it just cannot
be read — and nothing is committed. **This can only ever withhold.** There is no
path by which it raises a confidence or forces a commit, and the tests say so.

The framing guide's caption, which was static advice nobody needed after the
first ten seconds, now carries the live reason: "Bring your whole hand into
view", "Move closer to the camera", "Hold the shape still for a moment", "Turn
your palm toward the camera". Blocking problems are stated plainly; a merely
imperfect view gets the same words in a quieter register, because a hint that
shouts at every small imperfection is one people learn to ignore. It is a polite
live region, not an assertive one — a screen reader interrupting every letter to
say "move closer" would be worse than saying nothing.

Thresholds are deliberately generous. False nagging is worse than silence, and
an app that refuses to read a hand it could have read is worse than one that
occasionally guesses.

## Settings stopped being a wall

Forty-nine controls in one flat scroll. On a 390px phone that is roughly eight
screens of undifferentiated rows, and the effect of making every setting equally
available is that every setting is equally hard to find — including the two or
three that turn a frustrating session into a usable one.

Nothing was deleted. The default *view* was.

**One section open at a time.** Each of the ten groups is now a collapsed row
carrying its current value: "600 ms dwell · commits at 65%", "Mirrored · hand
overlay", "Per word · system voice". All ten fit on one phone screen, so the
panel opens as a contents page you can read at a glance — and often the summary
is the answer, so you never open the section at all.

**One switch for the rest.** "Show advanced settings", off by default, at the
bottom of the panel rather than the top: it describes what appears inside the
sections above it, and leading with it would make the first thing in Settings a
setting about settings. Behind it go frame rates, inference backends, speech
pitch, model precision, interim speech results — real settings a few people
genuinely need, in front of nobody by default. Advanced controls appear below
the essentials in a marked block, so turning the switch on adds rather than
rearranges.

**Except one thing, which cannot be folded away.** The first pass put
"on-device only" inside a collapsed Privacy section, and an E2E test failing was
what surfaced it. The brief is explicit that this is the single best trust
feature the app has, and burying the app's strongest claim about itself two taps
deep is exactly the wrong trade. There is now a permanent line under the header,
above the accordion: *Everything stays on this device.* The Privacy section
still holds the controls.

## The control bar measures itself

Captions sat at a fixed 96px from the bottom while the bar above them was any
height it liked — suggestions and correction chips come and go, and on a narrow
screen they wrapped to new rows. Picking one offset means wasting video for
everyone at the tall end and colliding at the short end.

The bar now publishes its height as `--sb-bar-h` through a ResizeObserver and
the caption band reads it. The chip rows also stopped wrapping: they scroll
sideways instead, so a fourth suggestion appearing no longer grows the bar by a
row and moves the buttons out from under the thumb already reaching for them.

## Touch targets, and things that were nearly the same size

Mode chips were 28px tall next to 44px utility buttons in the same row — both
hard to hit and visibly mismatched. Everything a thumb can hit is now at least
44px, except in landscape on a phone, where the whole bar compresses because
380px of height cannot spend a quarter of itself on buttons.

The utility icons were ⚙ ◍ ⏺ — text glyphs, whose font, weight and baseline vary
enough between platforms that the row looked misaligned on some of them. They
are SVG now. And the mode labels were "A·B·C", "Signs", "Talk", "Text→ASL": a
glyph string, a word, a word, and an arrow formula, reading as three different
kinds of thing inside one switcher. They are four plain words.

## Why M and T were still wrong: two bugs and a missing signal

"Corrections become training data" was written up as the real fix for the fist
cluster. It was not working, for two separate reasons, and both of them were in
the plumbing rather than in the idea.

### The correction filed the wrong frame

`lastFeaturesRef` was overwritten on every frame and read when the user tapped
the correction. Those are seconds apart. By the time somebody notices a wrong
letter, finds it in the strip and taps it, the hand has moved on — halfway into
the next letter, or back down to rest. So the sample labelled "T" was whatever
the hand was doing at tap time.

That is worse than filing nothing. It drags the T prototype toward a pose that
is not a T, so the more diligently someone corrected, the worse their model got.

The frames that produced a letter are now frozen at the moment it commits, and a
correction files three of them, spread across the hold. Frames the scan-quality
check rejected are never remembered, and a snapshot is spent once — tapping a
second alternate corrects the correction rather than teaching both.

### The fitted head was never consulted

Two personal heads are fitted from the same samples: nearest-centroid
prototypes, and a softmax head. The head was installed through
`setOnnxModel`, which only `predictAsync` reads — and nothing calls
`predictAsync`. The frame loop calls `predict`. So the head was fitted, stored,
reloaded on every launch, and never once used to classify anything. All
personalization was coming from the prototypes.

That matters most for exactly the letters it was meant to fix. Distance to a
centroid weights all 63 coordinates equally, so a T and an A that differ in a
handful and agree in the rest come out nearly equidistant. A fitted head learns
which coordinates carry the difference. It is a 24×63 matrix multiply —
microseconds — so it now runs inside `predict`, in its own slot, with the ONNX
slot left for a model that really would be async.

It stays silent below three examples of its rarest letter. A head fitted on one
or two samples per class memorises rather than generalises, and because it
memorises perfectly it comes out almost one-hot — confident enough to override
the prototypes even at a low blend weight. A ramp alone did not hold it back; a
floor does.

### Partial calibration was making things worse

The prototype blend scaled every letter down by the blend weight and then added
the personal mass back only to the calibrated ones. With six of twenty-four
letters recorded, those six absorbed a third of all probability regardless of
what the hand was doing. Anyone who started calibration and stopped partway
through was quietly degrading the app.

Both personal heads are now confined to the letters they have seen: they
redistribute the mass already sitting on those letters and leave every other
letter untouched. Two tests pin it, one of them checking exact equality on the
uncalibrated letters.

This is what makes the next part possible.

### Ninety seconds instead of four minutes

Full calibration is twenty-four letters and about four minutes, which is long
enough that most people never start. The fist cluster is six letters and about
ninety seconds, and it is where nearly all the errors are. It is now its own
entry in Settings, above the full run, and it says why it exists.

### A signal that does not depend on the thumb

Everything keyed on `thumbAcross` is asking about a thumb that, in T, N and M,
is underneath the fingers. MediaPipe does not measure it; it infers one, and the
inference is pulled toward the commonest fist, an A.

The fingers, though, are in plain view, and they are doing different things:

- **E** — fingertips reach down to meet a folded thumb, so the knuckles stay
  relatively open and the bend piles up in the middle and end joints.
- **A, S** — a real fist: every joint contributes about equally.
- **T, N, M** — the covering fingers lie *over* the thumb, which props them up.
  They fold sharply at the knuckle and stay comparatively straight past it — and
  only the fingers actually covering the thumb do, which is one in T, two in N,
  three in M.

`knuckleBend` measures what share of each finger's bend happens at the knuckle;
`drapedCount` turns that into a soft count of fingers lying over the thumb. That
count maps directly onto T, N and M without consulting the thumb at all.

**This is reasoned from how the letters are formed, not measured from signers.**
It is wired in as a nudge and never as a veto, so if the reasoning is wrong the
templates degrade rather than break, and an unambiguous A stays an A. Validating
it against real recordings is the obvious next step. Until then, personalization
is still the thing that actually fixes this cluster — which is why the two bugs
above mattered more than the new feature does.

## Letting the fingers outvote the thumb

`drapedCount` was added last round as a nudge and it did not fix the reported
problem: a T or an M still read as an A. Scoring the templates against a fist
whose thumb reads the way MediaPipe reports a hidden one showed why, and the
numbers were not close — A took 61–70% of the distribution while the fingers
were unambiguously saying M.

### A collected the letters nobody else could claim

A's thumb predicate was `below(thumbAcross, 0.18, 0.2)` — "the thumb is not far
across the knuckles". Every hallucinated thumb satisfies that, because the
hallucination *is* an A's thumb. T, N and M meanwhile each required their thumb
to be somewhere specific, and a hidden thumb is never there, so their predicate
zeroed and the letter was unreachable.

That asymmetry, not the missing feature, was the bug. The loosest requirement in
a cluster collects every hand the tighter ones reject.

So A now has to *show* its thumb rather than merely not contradict one: out past
the index knuckle on the radial side and above the knuckle line. A's thumb is
the one fist thumb fully in view, so requiring evidence of it is fair. And T, N
and M's thumb predicates became priors bounded in [0.55, 1] — they shade the
choice between the three when the guess is good and get out of the way when it
is not.

### A second signal off the fingers

`tipLift` is the perpendicular distance from the index/middle/ring fingertips to
the palm plane. In A and S the tips press into the palm; in E, T, N and M they
rest on a thumb and sit a thumb's thickness clear of it. Tips and palm are both
in plain view.

Paired with `drapedCount` it separates the cluster in two dimensions rather than
one: A and S are low-lift undraped, E is high-lift undraped, and T, N and M are
high-lift with one, two and three fingers draped. E gains a positive signature
it did not have.

### The floor under both

Both features are still reasoned from how the letters are formed rather than
measured from signers, so neither may multiply a letter's score by less than
`REASONED_FLOOR` (0.2). One alone moves a letter by at most 5x — enough to shade
a near-tie, not enough to overturn the thumb. Two agreeing move it by 25x, which
is enough, and that is the case where every visible part of the hand says the
same thing and only the invisible part disagrees.

The failure mode this guards is the features saying nothing useful. A test pins
it: when the fingers are uninformative the cluster falls back to A and the thumb
— the old behaviour — rather than inverting into a confident wrong answer.

### Making the reasoning checkable, and the fix findable

Two things follow from "reasoned, not measured":

- The debug panel now reports `drapedCount`, `tipLift` and `thumbAcross` live,
  with the expected band for each letter written next to them. Holding the six
  fists for a moment each is enough to find out whether the reasoning holds for
  a given hand, which turns an assumption into something a user can falsify in
  about a minute.
- The ninety-second fist calibration is offered in the frame after three
  corrections inside the cluster, instead of only in Settings. Three corrections
  is the app learning that its generic geometry does not fit this hand, and a
  fitted personal head is what fixes that — no amount of rule-tuning will.

Confidence in the occluded cases lands around 35–45%, below the 0.65 commit
threshold. So those letters are now withheld and offered as alternates rather
than committed. That is the intended trade: it was previously committing A at
70% and being wrong. The threshold was not touched.

## Replacing the personal model: a small MLP, and augmentation

Asked to make recognition "actually good", with a suggestion of running Ollama
in GitHub. Two separate ideas there, one wrong and one right.

**Wrong: an LLM as the classifier.** Ollama runs language models. The input here
is 63 floats of hand geometry at 30fps. An LLM is roughly three orders of
magnitude too slow for the 150ms budget and less accurate than a 20KB MLP,
because this is not a language problem.

**Wrong: inference in the cloud.** A network round-trip per frame breaks the
constraint `privacy.onDeviceOnly` exists to enforce, and GitHub Actions is CI,
not an inference host.

**Right: a small trained net is the fix**, and the architecture already had the
slot for it. **Right: GitHub Actions for _training_** — this machine has no
Python, which is the actual reason `training/` has never been run.

### What shipped

The personal head was multinomial logistic regression. That structure cannot
represent a conjunction: a linear model's answer to two features is always the
sum of its answers to each alone. The fist cluster *is* a conjunction — a thumb
reading low-across means A when the fingers are flat and means "the tracker is
guessing, ignore it" when they are draped. Opposite conclusions from the same
coordinate, decided by a different one.

So: one hidden layer, 63 -> 48 -> K, about 4,000 parameters, fitted in-browser.
Not because bigger is better. Because the previous shape could not express the
thing that was going wrong.

Eight samples would ordinarily memorise that. Three things stop it, in order:
fresh augmentation every epoch (each sample re-tilted and re-noised on every
pass, so no vector is ever seen twice), a narrow hidden layer, and weight decay.

`features/augment.ts` simulates out-of-plane tilt, per-landmark jitter, and
**more jitter on z than on x or y** — z is a weakly supervised offset rather
than a measurement, worst exactly where it matters most, and noising it harder
is a direct instruction not to lean on it. Every variant is re-normalized
through `normalizeHand`, so synthetic samples satisfy the same invariants as
real ones and cannot drift from the frame path.

### Measured

Synthetic hands, fitted on one session and scored at a **different hand angle**,
which is the situation a user is in every time they open the app after
calibrating. Six trials.

| | prototypes | linear (old) | MLP + aug (new) |
|---|---|---|---|
| all 10 letters | 81.8% | 68.1% | **89.2%** |
| fist cluster | 71.4% | 67.2% | **95.6%** |

The expected crossover — linear at low sample counts, MLP once there was enough
— does not exist. The MLP wins at every count tried, including two samples per
letter (89% vs 63% and 55%). Augmentation is why: two samples still produce
hundreds of distinct training vectors, so the regime where a linear model's
rigidity would protect it never arrives. `fitPersonalHead` therefore always
fits the MLP; `trainLinearHead` stays only so older stored heads keep loading.

These are synthetic hands. The comparison transfers; the absolute numbers do not.

### The number the UI is allowed to print

`trainAccuracy` sits near 100% whatever happens, so a held-out measure was added
— and then checked against the thing it looks like it predicts:

| scored | true cross-session | reported |
|---|---|---|
| plain | 89% / 96% | 98% / 100% |
| at training tilt | 89% / 96% | 96% / 95% |
| at 2x training tilt | 89% / 96% | 92% / 89% |

No setting tracks both cases. The reason is structural: **you cannot measure
robustness to a transformation you trained on.** The model is tilt-invariant
because augmentation taught it to be, so re-tilting withheld samples asks a
question it has been drilled on.

So the shipped measure scores at the training envelope — least-bad, never wildly
optimistic — and every place that displays it says it is a ceiling rather than a
forecast, with the measured optimism stated. It is a held-out sample, not a
held-out session, and emphatically not a held-out signer. No number from here
belongs in a model card.

### Also

- The debug panel reports which personal model is live. A head that fails to
  load, or loads into a slot nothing reads, produces no error and silently drops
  the app to geometric rules — that has shipped here before.
- The `MIN_HEAD_SAMPLES` floor of 3 stays, even though the MLP beats everything
  at 2. Loosening a safety threshold on synthetic evidence is not a trade worth
  taking, and one correction files three frames, so it switches on anyway.
- Stored linear heads carry no `kind`, so absence of one keeps meaning linear
  and existing calibrations survive the upgrade. Round-trip tested both ways.

### Still open

Nothing here helps a user who has not calibrated — it is a *personal* model by
construction. A shipped generic model needs a dataset; ChicagoFSWild is the
chosen candidate for Phase 1, and its current availability and licence terms
must be verified before anything trains on it. Training would run in GitHub
Actions, which is where that idea belongs.

## Picking a dataset, and making the training pipeline real

Two things, from "continue, make it good" after the on-device MLP landed.

### FSboard, not ChicagoFSWild

ChicagoFSWild was the chosen candidate. Checking its terms — which was the whole
point of checking — disqualified it:

**It has no licence.** No licence document, no data use agreement, no
redistribution terms. The page states a purpose ("in the interest of improving
digital interfaces for signers…") and asks for citation. A statement of purpose
is not a grant of rights, and there is no basis in it for shipping a derived
model in a public app.

**Its signers were never asked.** The clips are scraped from YouTube, aslized.org
and deafvideo.tv and annotated via Mechanical Turk. The page carries a notice
inviting people who find their own videos in it to get in touch — a takedown
mechanism, whose existence concedes the point.

Either fact alone rules it out here. Together they are the exact thing ETHICS.md
is about: a hearing-built ASL app trained on Deaf people's language taken from
public video without asking would earn the reaction it got.

**FSboard** ([arXiv:2407.15806](https://arxiv.org/abs/2407.15806)) is the
replacement: **CC BY 4.0**, and **147 paid and consenting Deaf signers**
recruited, shipped a phone, and compensated. Ten times larger than anything
else. It is the rare case where the ethically right choice is also the
technically better one.

The rule this establishes, written down in `docs/DATASETS.md`: a dataset needs
**both** a licence permitting what we intend **and** provenance the people in it
consented to. A permissive licence on non-consensual data is still
non-consensual data.

**The catch, which is not a licence problem.** FSboard is sequence-labelled — a
clip of a phrase, labelled with the phrase — and Phase 1's model is a per-frame
letter classifier. There is no frame-to-letter alignment. DATASETS.md sets out
the three ways to bridge that (CTC forced alignment, switch to a sequence model,
or hold-detection segmentation) and recommends the first. Nothing should be
written against FSboard until that is decided.

### The training pipeline now actually runs

It never had. It was written on a machine with no Python, against a dataset that
does not exist, and its README said so: "reviewed code, not tested code — expect
to fix small things on first run". Discovering those on the day someone finally
has data is the worst possible time.

A `training` CI job now runs both pipelines end to end on synthetic input from
`make_smoke_data.py`: train, evaluate, export, and verify the ONNX graph against
PyTorch. It proves the plumbing and says nothing about accuracy — the hands are
made up, and the generator says so loudly.

Writing it found two real bugs, neither of which anything would have surfaced
until it mattered.

**`build()` dropped the layer width.** `train_fingerspell.py` recorded `hidden`
in the checkpoint; `build()` ignored it and used the constructor default. So any
run with a non-default `--hidden` trained happily, printed its accuracy, and
left a `model.pt` that neither `evaluate.py` nor `export_onnx.py` could open —
`load_state_dict` fails on a size mismatch. `train_signs.py` did not record the
width at all. Both fixed, and the smoke run deliberately trains at a
**non-default width**, because a run at the default would pass either way.

**`evaluate.py` was reporting inflated accuracy.** It looped over every signer
under the heading "leave-one-signer-out" — but the model is trained once on a
fixed split and never refitted per fold, so for the ~75% of signers that were in
training, the fold was measuring training accuracy. Those folds went into
"Overall accuracy" and the per-class table.

That is the precise inflation this pipeline exists to prevent, printed by the
script whose job is to catch it. Headline numbers now come from held-out signers
only, read from `run.json`; training signers are still shown, labelled, and
excluded from every total, with the gap between them called out — a large gap
means the model learned particular people rather than the language.

### Honest limits

- The CI job has never run. It is written against scripts that have never
  executed, so the first push may well fail — which is the job working.
- `prepare_data.py`'s MediaPipe path is still uncovered: synthetic images
  contain no hands, so there is nothing for a landmarker to find.
- None of this puts a model in `public/models/`. The app still ships none, and
  the smoke job fails if a synthetic one ever leaks into the tree.

## Signs: 29 to 49, orientation, and a net to catch collisions

### Orientation was missing, and it was capping the vocabulary

A sign is handshape, location, movement, orientation, and non-manual markers.
The recogniser read three of them. That is not a gap in polish — a whole class
of signs is *defined* by the rotation and is otherwise identical to a sign
already in the file. Two flat hands in contact is SCHOOL, MONEY, STOP or BOOK
depending on almost nothing else.

`HandTrack` now carries `palmTurn` and `pointTurn`, measured start to end rather
than as a total swing: what separates these signs is which way the palm ends up
facing, not how much it wobbled getting there. BOOK, BAD and START are built on
it, and THANK-YOU needed it defensively — see below.

Non-manual markers remain unseen. That gap is much harder and is not close.

### 20 new signs, and the test that made adding them safe

Hand-written rules collide as they multiply, and the failure is silent: not a
crash, just one template quietly shadowing another, so somebody signs WAIT and
gets WANT and nothing anywhere reports a problem.

So every sign now has a canonical observation of itself
(`tests/helpers/signCases.ts`), and the suite asserts each one wins its own.
Written against the freshly-expanded 49, it immediately found four real
collisions:

| collision | cause | fix |
|---|---|---|
| HELLO ate THANK-YOU | both a flat hand near the face travelling out, and HELLO asked for strictly less | a salute goes out, not down |
| EAT ate HOME | both flattened-O at the face; only how far off-centre separates them | the canonical HOME was not far enough onto the cheek |
| THANK-YOU tied BAD | same hand, same chin, same direction | the palm turning over — orientation, newly available |
| WANT tied BIG | same two claw hands, same distance, opposite directions | WANT must not be spreading |

The lesson generalises: **the template that asks for the least wins**, and a new
sign is most dangerous to the one it resembles that was written loosest.

### Anything satisfied by doing nothing will fire on nothing

MOTHER was written as "open hand, at your face, one hand, not moving". Every one
of those clauses is also a true statement about a hand resting near your face,
and it scored 0.50 there — over the rejection floor, from a hand doing nothing.

MOTHER, FATHER and KNOW are taps in their citation form, so requiring the tap is
both more correct and what makes them separable from rest at all.

MY had no tap available — it is a flat hand held on the chest and nothing else —
and scored exactly 0.50 on an idle hand at chest height, a pre-existing bug the
old tests missed because they never checked that zone. Two changes, both
specific to hold-only signs:

- `stillness`, stricter than `held`, because a sign with no movement cannot
  afford a forgiving definition of "stayed put". MY had been scoring 0.82 on
  BAD — a hand that crosses two thirds of a shoulder width — on the strength of
  where it finished.
- `unambiguous`, which **sharpens the gate rather than adding a clause**. As a
  clause it was averaged in with five others that a resting hand satisfies
  perfectly, and a 0.25 diluted across seven terms moved the score not at all.
  The gate is a ceiling, so lowering it is the only move that cannot be averaged
  away.

An idle hand is now checked in every zone, at three distances from the midline,
and tops out at 0.25 against a floor of 0.45.

### CONFUSABLE is measured now, not guessed

Every pair in it comes from a sign scoring above 0.5 on another sign's canonical
observation, and a test fails if a real near-miss goes unlisted or if the map is
asymmetric — whoever signed it needs the other offered, whichever way round the
recogniser got it wrong. Three asymmetries existed and are fixed.

### What this still is not

Idealised observations. Passing means the rules are mutually *consistent* — no
two templates describe the same thing — and nothing about accuracy on a real
signer, which needs recordings and a held-out-signer evaluation. It is a lower
bound on how bad things can be, not an estimate of how good they are.

## Location said properly, and 97 signs

### The pipeline was throwing the face away

`bodyFrame` kept the two shoulders out of MediaPipe's 33 pose landmarks and
discarded the rest — including the nose, eyes, ears and mouth corners, which are
returned on every frame. So "location" meant one of five horizontal bands plus
how far off the midline the hand sat.

That is not a location. WATER taps the chin, MOTHER touches the chin, DEAF runs
ear to chin, SEE starts at the eye, THINK touches the temple — every one of them
is "the face band, somewhere". Any two signs sharing a handshape in that band
had nothing left to tell them apart.

`HandSample.near` now carries the distance to twelve named body anchors, and
`HandTrack.reached` the closest approach across the window — closest rather than
average, because contact is an event and DEAF touches two places in turn.

Two details that matter:

- **Measured from the working end of the hand**, not the wrist: fingertips,
  thumb, middle knuckle, whichever got closest. Which part touches varies by
  sign, and the wrist is most of a hand-length from all of them.
- **Falls back per anchor, not all-or-nothing.** The mouth corners drop out far
  more often than the shoulders; losing the mouth is no reason to stop knowing
  where the chest is. `NOMINAL_ANCHORS` is the fallback, and is also what the
  tests are written against, so a canonical observation and a real one mean the
  same thing by "at the chin".

### Two bugs the anchors' own tests caught

**The dominant-side ear was on the wrong side of the head.** `flip === -1` means
a right-dominant signer, whose dominant-side ear is the *right* ear; the code
picked the left. Every synthetic HandSample test in the suite passed through it
without noticing, because they build samples directly and never go through
`sampleFrame`. It took a test that starts from a pose.

**Absolute distance bands were wider than the gap between anchors.** Head
anchors sit about 0.2 shoulder widths apart, and the first bands were 0.14–0.38,
so a hand at the eye was also "at" the ear. THINK, HEAR, DEAF and CRY all
collapsed into each other.

The fix is `closerTo`, which asks which of two places the hand is *nearer*. That
is what location means phonemically — contrastive, not absolute — and a
comparison has no band to get wrong.

### 49 to 97

Eight more handshapes (L, F, baby-O, X, 3, bent-V, R, 4) and the anchors made
another 48 signs expressible. Their genuine overlaps are recorded rather than
denied: an L is an index with a thumb, a 3 is a V with a thumb, and an occluded
thumb is exactly what this project already knows not to trust.

The collision test found five more as they went in: THINK swallowing UNDERSTAND,
HEAR, CRY and DEAF; FINE swallowing LIKE; YES swallowing SELF and BATHROOM;
AGAIN swallowing NIGHT and COMPUTER; THIRSTY swallowing RED. Each is the same
shape of mistake — **the template that asks for the least wins** — and each was
fixed by making the loose one say what it actually requires: THINK is *still*,
FINE is *still open when it arrives*, YES is *vertical*, AGAIN comes *inward*.

### Where the ceiling is

At 97 signs, **55 of them have another sign scoring above 0.5 on their own
canonical observation**. At 29 it was a handful. The space that 22 handshapes,
12 anchors, orientation and a dozen movement patterns can separate is large, but
it is not unlimited, and the near-miss rate is the measurement of how full it is.

Going on to 150 this way would buy coverage with precision — which is the trade
`vocabulary.ts` was written to refuse: *"150 signs at 85% is a product, 2000
signs at 45% is a demo that wastes people's time."* 150 was always specified as
the target for a **trained model**, and that is still the honest route to it.
The rules are what makes the app work on day one with no dataset; they are not
what gets it to 150.

## Letters: one clause that fails should be fatal, and dwell should scale

### The letter templates had never had a separability test

The sign vocabulary got one and it found nine collisions. The 24 letter
templates are the same kind of code and had never had one: the fist cluster was
checked, because that is where the complaints came from, and the other eighteen
letters were on trust.

`tests/helpers/letterCases.ts` now holds a canonical hand per letter, and the
suite asserts each wins its own, scores above 0.8 on itself, and lists whatever
else fires on it.

### `geomean` was making decisive failures irrelevant

The header claimed a geometric mean meant "one confidently-failed predicate is
enough to rule a letter out". With eight clauses that is arithmetically false: a
clause failing at 0.2 among seven satisfied ones comes out at 0.2^(1/8) = 0.82 —
over the default commit threshold. The app would write the wrong letter with no
hesitation at all.

Measured, on a canonical hand for every letter:

| | scored on | before | after |
|---|---|---|---|
| Q | a G | 0.92 | 0.02 |
| K | a V | 0.82 | 0.51 |
| A | an X | 0.80 | 0.53 |
| R | a U | 0.74 | 0.40 |

Every one of those pairs differs by *exactly one predicate* — orientation, the
thumb, one half-curled finger, whether two fingers cross — and the single
deciding predicate was being averaged into nothing.

`combine` gives the weakest clause a third of the weight on its own and the mean
the rest. Not a plain minimum: landmarks are noisy, a real letter always has one
clause a little short, and scoring by the worst frame would refuse to recognise
anything. A third is decisive without being brittle. Near-miss pairs across the
alphabet went from 40 to 8, and the eight are the fist cluster.

P and Q also had orientation bands so soft they were decorative — `below(pointing,
-0.15, 0.45)` gives a sideways G a 0.56 on Q, and pointing down is the entire
content of both letters.

### A relaxed hand was a C at 0.97

`half()` peaks at exactly 0.5 extension, which is precisely what a hand at rest
reports, so every letter built on "half-curled fingers" loves a resting hand. C
asked only that the thumb be above 0.25 extension; a relaxed thumb reads 0.5.

This is the same bug the signs mode had — a relaxed hand near the face reading
as DRINK at 90% — and `features/handshapes.ts` had already fixed it there and
written down why. The letter had not been told. A relaxed hand now tops out at
0.44, under the commit threshold, and a test pins it.

### Dwell now scales with the evidence

A fixed dwell is the wrong shape for what a dwell does. It exists so the
classifier's frame-to-frame flicker can average out — but a letter arriving at
0.97 with nothing else above 0.01 has no flicker to average. The evidence
arrived complete, and the rest of the wait is dead time paid on every letter of
every word.

At the 600ms default, fed a steady distribution at 30fps:

| | scale | commits in |
|---|---|---|
| clean B, runner-up 0.01 | 0.49 | 297ms |
| good L, runner-up 0.05 | 0.78 | 495ms |
| ok W, runner-up 0.10 | 1.03 | 627ms |
| tight T vs N, runner-up 0.22 | 1.34 | 825ms |

Typical letters roughly halve; genuinely close ones get *slower*, which is the
right answer for the case that actually goes wrong.

Three constraints on it, all tested:

- **It never lowers the confidence threshold.** A letter still has to clear the
  user's bar to accumulate any dwell at all. Speed comes from letters that were
  never in doubt, not from accepting worse evidence.
- **High confidence in a near-tie gets no discount.** That combination is the
  fist cluster exactly, and hurrying there is how it goes wrong, so the weaker of
  confidence and margin governs.
- **A caller with no distribution is unchanged.** Unknown margin means the
  configured dwell, not "assume the worst" — reading it the other way silently
  made every label-only caller half a second slower, which the existing tests
  caught immediately.

The settings hint now says the dial is the middle of a range rather than a fixed
wait, because it is.

## J and Z: two letters that had never been tested, and one that raced

### They had no tests at all

Two of the twenty-six letters, with their own detection path, and no coverage of
any kind — "does J work" had no answer other than trying it. The static alphabet
at least had the fist cluster checked.

Writing the tests found J and Z **firing not at all** on trajectories built by
walking their own templates. `lastFireAt` initialised to `0`, and the refractory
period is "no motion letter within 700ms of the last one" — so a fresh detector
claimed one had fired at time zero and refused for the first 700ms of the
timeline.

Whether that bites depends entirely on the caller's clock. With
`performance.now()` the first frame is already thousands of milliseconds in and
nothing is blocked, which is presumably why it was never noticed. With any clock
starting near zero, J and Z are simply dead at the start of a session.
`DwellCommitter.lastCommitAt` already used `-Infinity`; this now does too.

### The static head was about to start eating them

J is an I that moves; Z is a D that moves. While either is being drawn the
static classifier reports that letter — correctly, and confidently, because that
genuinely is the handshape. Detection needs a full 12-frame window, about 400ms.
The static commit needs its dwell.

Those two race, and which wins is an accident of configuration. Adaptive dwell
made it a likelier accident: an unambiguous I now commits in about 300ms, before
the movement has been seen at all. The user draws a J and gets an I.

`MotionLetterDetector.inProgress` reports that a motion letter is under way, and
the frame loop withholds the static letter while it is — no label and no
distribution, the same withholding the scan-quality gate already uses, so the
smoothing window has nothing to average either.

It requires **movement**, not merely the handshape. A still I is an I and has to
commit as one; suppressing that would be a worse bug than the one being fixed,
and it is the first thing the tests check.

### Worth noting about the tests

They walk the same direction templates the detector matches against, so passing
means the machinery works — resampling, the path floor, the handshape gate, the
refractory period, the span normalization. It does **not** mean the templates
describe how a real person draws a J. Nothing here can tell you that, and the
templates remain unvalidated against a real signer.
