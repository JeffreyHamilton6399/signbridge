/**
 * Built-in whole-word signs, written as geometry rules.
 *
 * WHY RULES AND NOT A MODEL
 * -------------------------
 * A trained model beats this, but it needs a licensed dataset and a training
 * run. These rules need neither: they work the moment the app loads, they are
 * readable, and when one is wrong you can see exactly which clause failed. The
 * same approach carries fingerspelling in letterTemplates.ts.
 *
 * WHAT YOU SHOULD EXPECT
 * ----------------------
 * This is 29 signs, not a language. It is chosen for signs that are (a) common
 * in conversation and (b) geometrically distinct from each other — which is a
 * real constraint, not a shortcut. Signs that differ only by a subtle handshape
 * the camera cannot resolve are deliberately absent, because including them
 * would mean guessing.
 *
 * Accuracy is well below a trained model's and varies hugely with lighting,
 * framing and signing style. Every match carries its confidence, the rejection
 * floor means an unrecognised movement produces *nothing* rather than the
 * least-bad guess, and CONFUSABLE below names the pairs this genuinely cannot
 * separate. Do not raise the numbers by lowering the floor.
 *
 * A sign is handshape + location + movement + orientation. Non-manual markers —
 * face and eyebrows — carry grammar this does not see at all, so these are
 * lexical guesses, not meaning.
 */
import { handshape } from '@/features/handshapes';
import type { HandshapeName } from '@/features/handshapes';
import { clamp01, ramp } from '@/features/handGeometry';
import type { HandTrack, SignObservation, Zone } from './observation';

// ---------------------------------------------------------------------------
// Predicates over a hand's track through the window
// ---------------------------------------------------------------------------

/** Handshape at a point in the sign. Signs drift, so mid is usually the honest one. */
function shape(track: HandTrack | null, name: HandshapeName, when: 'start' | 'mid' | 'end' = 'mid'): number {
  if (!track) return 0;
  return handshape(name, track[when].geometry);
}

/** Best handshape score across the window — for signs whose shape changes. */
function shapeAnywhere(track: HandTrack | null, name: HandshapeName): number {
  if (!track) return 0;
  return Math.max(
    handshape(name, track.start.geometry),
    handshape(name, track.mid.geometry),
    handshape(name, track.end.geometry),
  );
}

function inZone(track: HandTrack | null, ...zones: Zone[]): number {
  if (!track) return 0;
  if (zones.includes(track.dominantZone)) return 1;
  // Partial credit when the hand passed through the zone without settling.
  return zones.some((z) => track.zones.includes(z)) ? 0.45 : 0.05;
}

/** Moved away from the body on the dominant side. */
const movedOut = (t: HandTrack | null) => (t ? ramp(t.net.x, 0.04, 0.32) : 0);
const movedDown = (t: HandTrack | null) => (t ? ramp(t.net.y, 0.05, 0.34) : 0);
const movedUp = (t: HandTrack | null) => (t ? ramp(-t.net.y, 0.05, 0.34) : 0);

/** Stayed put — a held sign rather than a travelling one. */
const held = (t: HandTrack | null) => (t ? 1 - ramp(t.path, 0.3, 1.0) : 0);

/** Repeated back-and-forth movement: taps, shakes, nods. */
const repeated = (t: HandTrack | null, min = 2) =>
  t ? ramp(t.reversals, min - 1, min) : 0;

/** Movement that returns roughly to where it began and covers both axes. */
const circular = (t: HandTrack | null) =>
  t ? Math.min(ramp(t.closedness, 0.45, 0.8), ramp(t.roundness, 0.35, 0.7)) : 0;

/** Travelled a real distance rather than jittering. */
const travelled = (t: HandTrack | null, min = 0.35) => (t ? ramp(t.path, min * 0.5, min) : 0);

/** Near the body's midline — pointing at yourself, not out to the side. */
const centred = (t: HandTrack | null) => (t ? 1 - ramp(Math.abs(t.mid.pos.x), 0.2, 0.5) : 0);
/** Out to the dominant side. */
const lateral = (t: HandTrack | null) => (t ? ramp(Math.abs(t.mid.pos.x), 0.25, 0.55) : 0);

const yes = (b: boolean) => (b ? 1 : 0.06);

/** Zone check against a specific moment rather than the whole window. */
function zoneAt(track: HandTrack | null, when: 'start' | 'end', ...zones: Zone[]): number {
  if (!track) return 0;
  return zones.includes(track[when].zone) ? 1 : 0.08;
}

function geomean(parts: number[]): number {
  if (parts.length === 0) return 0;
  let logSum = 0;
  for (const p of parts) logSum += Math.log(Math.max(p, 1e-4));
  return clamp01(Math.exp(logSum / parts.length));
}

/**
 * Score a sign, gated on its handshape.
 *
 * A plain geometric mean lets a weak handshape hide behind clauses that are
 * trivially true. "One hand, near the face" is satisfied by a hand resting near
 * your face, so a mediocre W-shape score of 0.32 would come out as 0.68 — and a
 * relaxed hand would read as WATER.
 *
 * The gate fixes that: **a sign is never more certain than its handshape.** The
 * location and movement clauses can only lower the score from there, never
 * rescue it. Every template goes through here.
 */
function gated(shapeGate: number, clauses: number[]): number {
  const parts = [shapeGate, ...clauses];
  // Counting the weakest clause twice keeps a badly-failed location or movement
  // from being averaged away by clauses that are trivially true — the same
  // dilution the handshape gate fixes, applied to the rest of the sign. A plain
  // minimum would be more correct still, but too brittle for noisy landmarks:
  // this leaves a realistic, slightly-sloppy sign scoring well while a hand at
  // rest in the wrong place cannot reach the floor.
  return Math.min(shapeGate, geomean([...parts, Math.min(...parts)]));
}

// ---------------------------------------------------------------------------

export interface SignTemplate {
  gloss: string;
  /** How to make the sign, shown in the UI when it is offered as an alternate. */
  hint: string;
  score(o: SignObservation): number;
}

const S = (gloss: string, hint: string, score: (o: SignObservation) => number): SignTemplate => ({
  gloss,
  hint,
  score,
});

export const SIGN_TEMPLATES: readonly SignTemplate[] = [
  // --- one-handed, at the head or face -------------------------------------

  S('HELLO', 'Flat hand at your temple, salute outward.', (o) =>
    gated(shape(o.dominant, 'flat'), [
      yes(!o.handsContact),
      inZone(o.dominant, 'head', 'face'),
      movedOut(o.dominant),
      travelled(o.dominant, 0.3),
    ]),
  ),

  S('THANK-YOU', 'Flat hand at your chin, move it forward and down.', (o) =>
    gated(shape(o.dominant, 'flat'), [
      yes(!o.handsContact),
      zoneAt(o.dominant, 'start', 'face', 'neck'),
      movedDown(o.dominant),
      travelled(o.dominant, 0.3),
    ]),
  ),

  S('GOOD', 'Flat hand from your chin down onto your other palm.', (o) =>
    gated(Math.min(shape(o.dominant, 'flat', 'start'), shape(o.other, 'flat', 'end')), [
      yes(o.twoHanded),
      // The chin start is the whole difference between GOOD and STOP.
      zoneAt(o.dominant, 'start', 'face', 'neck'),
      movedDown(o.dominant),
      yes(o.handsContact),
    ]),
  ),

  S('EAT', 'Flattened-O hand tapping at your mouth.', (o) =>
    gated(shapeAnywhere(o.dominant, 'flatO'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'face'),
      centred(o.dominant),
    ]),
  ),

  S('DRINK', 'C hand at your mouth, tip it up like a cup.', (o) =>
    gated(shapeAnywhere(o.dominant, 'c'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'face'),
      centred(o.dominant),
    ]),
  ),

  S('WATER', 'W hand tapping your chin.', (o) =>
    gated(shapeAnywhere(o.dominant, 'w'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'face'),
    ]),
  ),

  S('HOME', 'Flattened-O hand touching your cheek.', (o) =>
    gated(shapeAnywhere(o.dominant, 'flatO'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'face', 'head'),
      lateral(o.dominant),
    ]),
  ),

  S('DEAF', 'Index finger from near your ear down to your chin.', (o) =>
    gated(shape(o.dominant, 'index'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'face', 'head'),
      travelled(o.dominant, 0.28),
    ]),
  ),

  S('SEE', 'V hand near your eyes, moving outward.', (o) =>
    gated(shape(o.dominant, 'v'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'face', 'head', 'neck'),
      movedOut(o.dominant),
    ]),
  ),

  // --- one-handed, at the chest --------------------------------------------

  S('PLEASE', 'Flat hand circling on your chest.', (o) =>
    gated(shape(o.dominant, 'flat'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'chest'),
      circular(o.dominant),
    ]),
  ),

  S('SORRY', 'Fist circling on your chest.', (o) =>
    gated(shape(o.dominant, 'fist'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'chest'),
      circular(o.dominant),
    ]),
  ),

  S('MY', 'Flat hand resting flat on your chest.', (o) =>
    gated(shape(o.dominant, 'flat'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'chest'),
      held(o.dominant),
      centred(o.dominant),
    ]),
  ),

  S('ME', 'Index finger pointing at your own chest.', (o) =>
    gated(shape(o.dominant, 'index'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'chest', 'neck'),
      centred(o.dominant),
      held(o.dominant),
    ]),
  ),

  S('YOU', 'Index finger pointing outward, away from you.', (o) =>
    gated(shape(o.dominant, 'index'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'chest', 'neck'),
      lateral(o.dominant),
    ]),
  ),

  S('YES', 'Fist nodding up and down, like a head nodding.', (o) =>
    gated(shape(o.dominant, 'fist'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'chest', 'neck'),
      repeated(o.dominant, 2),
      1 - ramp(o.dominant?.extent.x ?? 0, 0.2, 0.5),
    ]),
  ),

  S('NO', 'Index and middle finger tapping down onto your thumb.', (o) =>
    gated(shapeAnywhere(o.dominant, 'h'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'chest', 'neck'),
      repeated(o.dominant, 2),
    ]),
  ),

  S('WHERE', 'Index finger up, shaking side to side.', (o) =>
    gated(shape(o.dominant, 'index'), [
      yes(!o.twoHanded),
      repeated(o.dominant, 3),
      ramp(o.dominant?.extent.x ?? 0, 0.08, 0.25),
    ]),
  ),

  S('HUNGRY', 'C hand drawn down the middle of your chest.', (o) =>
    gated(shapeAnywhere(o.dominant, 'c'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'neck', 'chest'),
      movedDown(o.dominant),
      centred(o.dominant),
    ]),
  ),

  S('I-LOVE-YOU', 'Thumb, index and little finger out; hold it up.', (o) =>
    gated(shapeAnywhere(o.dominant, 'ily'), [held(o.dominant)]),
  ),

  // --- two-handed ----------------------------------------------------------

  S('STOP', 'Chop the edge of one flat hand down onto the other palm.', (o) =>
    gated(Math.min(shape(o.dominant, 'flat'), shape(o.other, 'flat')), [
      yes(o.twoHanded),
      // Unlike GOOD, this starts at chest height rather than at the chin.
      zoneAt(o.dominant, 'start', 'chest', 'neck'),
      movedDown(o.dominant),
      yes(o.handsContact),
      yes(o.contacts <= 1),
    ]),
  ),

  S('HELP', 'Thumb-up fist resting on your flat palm; lift both together.', (o) =>
    gated(Math.min(shapeAnywhere(o.dominant, 'thumbUp'), shape(o.other, 'flat')), [
      yes(o.twoHanded),
      movedUp(o.dominant),
      yes(o.handsContact),
    ]),
  ),

  S('MORE', 'Both hands flattened-O, fingertips tapping together.', (o) =>
    gated(Math.min(shapeAnywhere(o.dominant, 'flatO'), shapeAnywhere(o.other, 'flatO')), [
      yes(o.twoHanded),
      yes(o.contacts >= 1),
      repeated(o.dominant, 2),
    ]),
  ),

  S('NAME', 'Both H hands, tapping one across the other.', (o) =>
    gated(Math.min(shapeAnywhere(o.dominant, 'h'), shapeAnywhere(o.other, 'h')), [
      yes(o.twoHanded),
      yes(o.handsContact),
    ]),
  ),

  S('SCHOOL', 'Clap your flat hands together twice.', (o) =>
    gated(Math.min(shape(o.dominant, 'flat'), shape(o.other, 'flat')), [
      yes(o.twoHanded),
      yes(o.contacts >= 2),
    ]),
  ),

  S('WORK', 'Both fists; tap one wrist down on the other.', (o) =>
    gated(Math.min(shape(o.dominant, 'fist'), shape(o.other, 'fist')), [
      yes(o.twoHanded),
      yes(o.contacts >= 2),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  S('LOVE', 'Both fists crossed over your chest, held still.', (o) =>
    gated(Math.min(shape(o.dominant, 'fist'), shape(o.other, 'fist')), [
      yes(o.twoHanded),
      yes(o.handsContact),
      yes(o.contacts <= 1),
      held(o.dominant),
      inZone(o.dominant, 'chest', 'neck'),
    ]),
  ),

  S('FINISH', 'Both open hands at your chest, flipping outward.', (o) =>
    gated(Math.min(shape(o.dominant, 'open'), shape(o.other, 'open')), [
      yes(o.twoHanded),
      inZone(o.dominant, 'chest', 'neck'),
      ramp(o.dominant?.extent.x ?? 0, 0.15, 0.4),
      yes(!o.handsContact),
    ]),
  ),

  S('WHAT', 'Both open hands low, palms up, shaking slightly.', (o) =>
    gated(Math.min(shape(o.dominant, 'open'), shape(o.other, 'open')), [
      yes(o.twoHanded),
      inZone(o.dominant, 'chest', 'waist'),
      repeated(o.dominant, 3),
      1 - ramp(o.dominant?.extent.x ?? 0, 0.25, 0.5),
    ]),
  ),

  S('WANT', 'Both hands curved like claws, pulling in toward you.', (o) =>
    gated(Math.min(shape(o.dominant, 'claw'), shape(o.other, 'claw')), [
      yes(o.twoHanded),
      inZone(o.dominant, 'chest', 'waist'),
      yes(!o.handsContact),
      travelled(o.dominant, 0.25),
    ]),
  ),
];

/** Signs this genuinely cannot tell apart, surfaced in the UI. */
export const CONFUSABLE: Record<string, readonly string[]> = {
  HELLO: ['THANK-YOU'],
  'THANK-YOU': ['HELLO', 'GOOD'],
  GOOD: ['THANK-YOU', 'STOP'],
  EAT: ['HOME', 'DRINK'],
  HOME: ['EAT'],
  DRINK: ['EAT', 'HUNGRY'],
  ME: ['YOU', 'MY'],
  YOU: ['ME', 'WHERE'],
  MY: ['ME', 'PLEASE'],
  PLEASE: ['SORRY', 'MY'],
  SORRY: ['PLEASE', 'YES'],
  YES: ['SORRY', 'NO'],
  NO: ['YES', 'NAME'],
  WHERE: ['NO', 'YOU'],
  STOP: ['GOOD', 'SCHOOL'],
  SCHOOL: ['STOP', 'MORE'],
  MORE: ['SCHOOL', 'NAME'],
  WORK: ['LOVE'],
  LOVE: ['WORK'],
  FINISH: ['WHAT'],
  WHAT: ['FINISH', 'WANT'],
  WANT: ['WHAT'],
  NAME: ['MORE', 'NO'],
  HELP: ['STOP'],
};

export const BUILT_IN_GLOSSES: readonly string[] = SIGN_TEMPLATES.map((t) => t.gloss);

const HINT_BY_GLOSS = new Map(SIGN_TEMPLATES.map((t) => [t.gloss, t.hint]));

export function signHint(gloss: string): string {
  return HINT_BY_GLOSS.get(gloss) ?? '';
}

// ---------------------------------------------------------------------------

export interface SignCandidate {
  gloss: string;
  confidence: number;
  /** Raw template score before normalization, for the debug overlay. */
  raw: number;
}

/**
 * Raw score a template must reach before we will call it a match.
 *
 * This is the "no sign / transition" class. Without it the recogniser returns
 * its least-bad guess for every hand movement, including scratching your nose,
 * and the transcript fills with noise.
 *
 * Set from the synthetic separation (idle poses top out around 0.40, clean
 * signs reach 1.0) but kept close to the idle ceiling rather than midway,
 * because real observations never score like the synthetic ones: MediaPipe's
 * handshapes are noisy, and every clause is a little short of perfect. Tuned to
 * the clean numbers, this silenced the mode completely. A candidate that clears
 * this is *offered*; committing it is a separate, higher bar.
 */
export const REJECTION_FLOOR = 0.45;

/** Sharpness of the softmax over template scores. */
const TEMPERATURE = 0.12;

/**
 * Score every template against one observation.
 *
 * Returns an empty array when nothing clears the floor — which is the common
 * case during transitions, and is correct.
 */
export function recognizeSign(observation: SignObservation, topK = 3): SignCandidate[] {
  // Without pose we have no body reference, so every location clause is a
  // guess. Refuse rather than pretend.
  if (observation.bodyUnknown || !observation.dominant) return [];

  const raw = SIGN_TEMPLATES.map((t) => ({ gloss: t.gloss, raw: t.score(observation) }));
  const best = raw.reduce((a, b) => (b.raw > a.raw ? b : a));
  if (best.raw < REJECTION_FLOOR) return [];

  const max = Math.max(...raw.map((r) => r.raw));
  const exps = raw.map((r) => Math.exp((r.raw - max) / TEMPERATURE));
  const total = exps.reduce((a, b) => a + b, 0) || 1;

  return raw
    .map((r, i) => ({
      gloss: r.gloss,
      raw: r.raw,
      // Scale the softmax by how well the winner actually matched, so a weak
      // best-of-a-bad-lot does not report 95%.
      confidence: (exps[i] / total) * clamp01(best.raw),
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, topK);
}
