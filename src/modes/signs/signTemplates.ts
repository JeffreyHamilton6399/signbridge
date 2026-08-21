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
 * This is 49 signs, not a language. It is chosen for signs that are (a) common
 * in conversation and (b) geometrically distinct from each other — which is a
 * real constraint, not a shortcut. Signs that differ only by a subtle handshape
 * the camera cannot resolve are deliberately absent, because including them
 * would mean guessing.
 *
 * Every sign here is checked against a canonical observation of itself and of
 * every other sign (tests/helpers/signCases.ts). That is what makes the list
 * safe to grow: hand-written rules collide as they multiply, and the way that
 * shows up is not a crash but one template quietly shadowing another. Four such
 * collisions existed the moment this went from 29 signs to 49, and the test
 * named all four. Do not add a sign without adding its case.
 *
 * Accuracy is well below a trained model's and varies hugely with lighting,
 * framing and signing style. Every match carries its confidence, the rejection
 * floor means an unrecognised movement produces *nothing* rather than the
 * least-bad guess, and CONFUSABLE below names the pairs this genuinely cannot
 * separate. Do not raise the numbers by lowering the floor.
 *
 * A sign is handshape + location + movement + orientation. All four are now
 * read; orientation arrived last, and its absence had been quietly capping what
 * could be expressed here — BOOK is two flat palms in contact, which without
 * rotation is also SCHOOL, MONEY and STOP.
 *
 * Non-manual markers — face and eyebrows — carry grammar this does not see at
 * all, so these are lexical guesses, not meaning. That gap is much harder than
 * the orientation one and is not on the near horizon.
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

/**
 * Genuinely motionless, for signs that are nothing but a shape held in a place.
 *
 * {@link held} is deliberately forgiving, because most signs that 'stay put'
 * still drift. A hold-only sign cannot afford that: MY is a flat hand at the
 * chest and nothing else, so it scored 0.82 on BAD — a flat hand that starts at
 * the chin, travels two thirds of a shoulder width and ends at the chest — on
 * the strength of where it finished.
 */
const stillness = (t: HandTrack | null) => (t ? 1 - ramp(t.path, 0.15, 0.5) : 0);

/**
 * The handshape is unambiguous, not merely the best available reading.
 *
 * For a sign made of a handshape, a place and stillness, the handshape is the
 * only evidence there is — the other clauses are also true of a hand doing
 * nothing at all. A relaxed half-open hand reads 0.5 as 'flat', which was
 * enough to put MY over the rejection floor on an idle hand at chest height.
 *
 * So hold-only signs are held to a higher bar: be clearly this handshape, or do
 * not fire. Signs with a movement or a contact to their name do not need this,
 * because those clauses already fail on a hand at rest.
 *
 * This sharpens the *gate* rather than adding a clause, and that distinction
 * matters. As a clause it was averaged in with five others that a resting hand
 * satisfies perfectly, and a 0.25 diluted across seven terms left the score
 * exactly where it started. The gate is a ceiling, so lowering it is the only
 * move that cannot be averaged away.
 */
const unambiguous = (shapeScore: number) => shapeScore * ramp(shapeScore, 0.45, 0.65);

/** Stayed put — a held sign rather than a travelling one. */
const held = (t: HandTrack | null) => (t ? 1 - ramp(t.path, 0.3, 1.0) : 0);

/**
 * A tap: the hand stays put but reverses at least once.
 *
 * This exists because of a false positive that is worth remembering. MOTHER was
 * written as open hand + face zone + one hand + held, and every one of those
 * clauses is *also a description of a hand resting near your face*. It scored
 * 0.50 on exactly the idle pose the rejection floor was built to silence.
 *
 * Anything whose clauses are all satisfied by doing nothing will fire on doing
 * nothing, however good the handshape gate is. These signs are taps in their
 * citation form, so requiring the tap is both more correct and what makes them
 * distinguishable from rest at all.
 */
const tapped = (t: HandTrack | null) => (t ? ramp(t.reversals, 0, 1) : 0);

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

// --- orientation, the fourth parameter --------------------------------------
//
// A sign is handshape, location, movement, *orientation*, and non-manual
// markers. Until HandTrack carried palmTurn and pointTurn this recogniser had
// three of the five, and the missing one is not a detail: a whole class of
// signs is defined by the rotation and is otherwise identical to another sign
// already in this file. Two flat hands in contact is SCHOOL, MONEY, STOP or
// BOOK depending on almost nothing else.
//
// Non-manual markers remain unseen, and that is a much harder gap — see the
// note at the top of this file.

/** Palm rotated to face the signer's front — supination, as in BOOK opening. */
const turnsPalmUp = (t: HandTrack | null) => (t ? ramp(t.palmTurn, 0.25, 0.75) : 0);
/** Palm rotated away, as in BAD flipping over. */
const turnsPalmDown = (t: HandTrack | null) => (t ? ramp(-t.palmTurn, 0.25, 0.75) : 0);
/** Rotated, in either direction — a twist rather than a hold. */
const twists = (t: HandTrack | null) => (t ? ramp(Math.abs(t.palmTurn), 0.3, 0.8) : 0);
/** Fingers tipped down over the window, as in a hand flipping over. */
const tipsDown = (t: HandTrack | null) => (t ? ramp(-t.pointTurn, 0.3, 0.9) : 0);

// --- two-handed relationships ------------------------------------------------

/**
 * The hands travelled away from each other.
 *
 * Read from the two tracks' net x rather than from a gap measurement, because
 * `minHandGap` only records the closest approach — it cannot tell BIG from
 * SMALL, which are the same two hands at the same two distances in opposite
 * order. In the mirrored frame +x is outward on the dominant side, so hands
 * separating means the dominant goes positive and the other negative.
 */
const spreadApart = (o: SignObservation) =>
  o.dominant && o.other
    ? Math.min(ramp(o.dominant.net.x, 0.05, 0.3), ramp(-o.other.net.x, 0.05, 0.3))
    : 0;

/** The hands travelled toward each other. */
const cameTogether = (o: SignObservation) =>
  o.dominant && o.other
    ? Math.min(ramp(-o.dominant.net.x, 0.05, 0.3), ramp(o.other.net.x, 0.05, 0.3))
    : 0;

/** Both hands make the same shape — the common case for two-handed signs. */
const bothShape = (o: SignObservation, name: HandshapeName) =>
  Math.min(shape(o.dominant, name), shape(o.other, name));

/** Both hands make the same shape at some point, for signs whose shape changes. */
const bothShapeAnywhere = (o: SignObservation, name: HandshapeName) =>
  Math.min(shapeAnywhere(o.dominant, name), shapeAnywhere(o.other, name));

/** Shape changed from one to another across the window, as in MANY or SLEEP. */
const shapeChanges = (t: HandTrack | null, from: HandshapeName, to: HandshapeName) =>
  t ? Math.min(handshape(from, t.start.geometry), handshape(to, t.end.geometry)) : 0;

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
      // A salute goes out, not down. Without this HELLO also describes
      // THANK-YOU — same flat hand, same region, also travelling outward — and
      // won it, because HELLO asks for less.
      1 - movedDown(o.dominant),
    ]),
  ),

  S('THANK-YOU', 'Flat hand at your chin, move it forward and down.', (o) =>
    gated(shape(o.dominant, 'flat'), [
      yes(!o.handsContact),
      zoneAt(o.dominant, 'start', 'face', 'neck'),
      movedDown(o.dominant),
      travelled(o.dominant, 0.3),
      // The palm stays turned toward you the whole way. BAD is the same hand
      // leaving the same chin in the same direction and turning over as it
      // goes, so without orientation the two are one sign.
      1 - Math.max(turnsPalmDown(o.dominant), tipsDown(o.dominant)),
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
    gated(unambiguous(shape(o.dominant, 'flat')), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'chest'),
      // A hold-only sign: no movement, no contact, no shape change. Both of
      // these are stricter than their usual counterparts for that reason —
      // there is nothing else here to rule anything out.
      stillness(o.dominant),
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
      // Stated as 'not spreading' rather than 'coming together': WANT draws the
      // hands toward the body, which barely changes their separation, so
      // requiring convergence would fail on the real sign. BIG is the same two
      // claw hands travelling the same distance in the opposite direction, and
      // this is the only thing between them.
      1 - spreadApart(o),
    ]),
  ),

  // --- at the forehead ------------------------------------------------------
  //
  // The head band is barely used above, and it is where a lot of common
  // vocabulary lives. These three sit in it and are separated by handshape
  // alone — open, flat, index — which is the separation the handshape gate is
  // best at. FATHER and MOTHER are the same sign at forehead and chin, which is
  // genuinely how they are formed and genuinely the riskiest pair here: it
  // rests entirely on the head/face zone boundary. Both are in CONFUSABLE.

  S('FATHER', 'Open hand, thumb tapping your forehead.', (o) =>
    gated(shape(o.dominant, 'open'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'head'),
      held(o.dominant),
      tapped(o.dominant),
    ]),
  ),

  S('KNOW', 'Flat hand tapping your forehead.', (o) =>
    gated(shape(o.dominant, 'flat'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'head'),
      // HELLO is the same hand in the same place travelling outward; this one
      // stays put. That is the whole difference and it has to carry weight.
      held(o.dominant),
      1 - movedOut(o.dominant),
      tapped(o.dominant),
    ]),
  ),

  S('THINK', 'Index finger touching your temple.', (o) =>
    gated(shape(o.dominant, 'index'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'head'),
      held(o.dominant),
    ]),
  ),

  // --- at the chin and face -------------------------------------------------

  S('MOTHER', 'Open hand, thumb tapping your chin.', (o) =>
    gated(shape(o.dominant, 'open'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'face'),
      held(o.dominant),
      tapped(o.dominant),
    ]),
  ),

  S('SLEEP', 'Open hand down over your face, closing as it falls.', (o) =>
    gated(shapeChanges(o.dominant, 'open', 'flatO'), [
      yes(!o.twoHanded),
      zoneAt(o.dominant, 'start', 'face', 'head'),
      movedDown(o.dominant),
    ]),
  ),

  S('BAD', 'Flat hand from your chin, turning over as it comes down.', (o) =>
    gated(shape(o.dominant, 'flat'), [
      // One-handed is what separates this from GOOD, which lands on the other
      // palm; the turn is what separates it from a hand simply dropping.
      yes(!o.twoHanded),
      zoneAt(o.dominant, 'start', 'face'),
      movedDown(o.dominant),
      Math.max(turnsPalmDown(o.dominant), tipsDown(o.dominant)),
    ]),
  ),

  S('FINE', 'Open hand, thumb on your chest, moving forward and out.', (o) =>
    gated(shape(o.dominant, 'open'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'chest', 'neck'),
      movedOut(o.dominant),
    ]),
  ),

  // --- two-handed, rotation-defined ----------------------------------------

  S('BOOK', 'Flat palms together, opening like a book.', (o) =>
    gated(bothShape(o, 'flat'), [
      yes(o.twoHanded),
      yes(o.handsContact),
      // Without this clause BOOK is indistinguishable from SCHOOL, MONEY and
      // STOP. It is the whole sign.
      turnsPalmUp(o.dominant),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  S('MANY', 'Both fists at your chest, flicking open into fives.', (o) =>
    gated(
      Math.min(shapeChanges(o.dominant, 'fist', 'open'), shapeChanges(o.other, 'fist', 'open')),
      [yes(o.twoHanded), inZone(o.dominant, 'chest', 'neck'), yes(!o.handsContact)],
    ),
  ),

  S('BIG', 'Both hands facing each other, pulling wide apart.', (o) =>
    gated(bothShapeAnywhere(o, 'claw'), [
      yes(o.twoHanded),
      spreadApart(o),
      yes(!o.handsContact),
      inZone(o.dominant, 'chest', 'neck'),
    ]),
  ),

  S('SMALL', 'Both flat hands facing each other, closing together.', (o) =>
    gated(bothShape(o, 'flat'), [
      yes(o.twoHanded),
      cameTogether(o),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  // --- two-handed, at the chest --------------------------------------------

  S('HAPPY', 'Flat hands brushing up your chest, over and over.', (o) =>
    gated(bothShape(o, 'flat'), [
      yes(o.twoHanded),
      inZone(o.dominant, 'chest'),
      repeated(o.dominant, 2),
      movedUp(o.dominant),
    ]),
  ),

  S('TIRED', 'Both hands bent, fingertips on your chest, sinking down.', (o) =>
    gated(bothShape(o, 'bent'), [
      yes(o.twoHanded),
      inZone(o.dominant, 'chest'),
      movedDown(o.dominant),
    ]),
  ),

  S('MEET', 'Two index fingers upright, coming together.', (o) =>
    gated(bothShape(o, 'index'), [
      yes(o.twoHanded),
      cameTogether(o),
      yes(o.handsContact),
      inZone(o.dominant, 'chest', 'neck'),
    ]),
  ),

  S('AGAIN', 'Bent hand arcing over and down into your flat palm.', (o) =>
    gated(Math.min(shapeAnywhere(o.dominant, 'bent'), shape(o.other, 'flat')), [
      yes(o.twoHanded),
      yes(o.handsContact),
      yes(o.contacts <= 1),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  S('START', 'Index finger twisting in your other flat palm.', (o) =>
    gated(Math.min(shape(o.dominant, 'index'), shape(o.other, 'flat')), [
      yes(o.twoHanded),
      yes(o.handsContact),
      held(o.dominant),
      // The finger stays put and turns. Without this it is a fingertip resting
      // in a palm, which is most of the two-handed contact signs above.
      twists(o.dominant),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  S('MONEY', 'Flattened-O hand tapping into your flat palm.', (o) =>
    gated(Math.min(shapeAnywhere(o.dominant, 'flatO'), shape(o.other, 'flat')), [
      yes(o.twoHanded),
      yes(o.contacts >= 2),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  S('CAR', 'Both fists gripping a wheel, turning it back and forth.', (o) =>
    gated(bothShape(o, 'fist'), [
      yes(o.twoHanded),
      yes(!o.handsContact),
      repeated(o.dominant, 2),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  S('COFFEE', 'One fist circling on top of the other.', (o) =>
    gated(bothShape(o, 'fist'), [
      yes(o.twoHanded),
      circular(o.dominant),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  S('WAIT', 'Both hands curved, fingers wiggling in front of you.', (o) =>
    gated(bothShape(o, 'claw'), [
      yes(o.twoHanded),
      yes(!o.handsContact),
      repeated(o.dominant, 2),
      // Small movement — WANT is the same handshape travelling toward you.
      1 - travelled(o.dominant, 0.3),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),
];

/**
 * Signs this genuinely cannot tell apart, surfaced in the UI so a wrong guess
 * is one tap from the right answer.
 *
 * Every pair here is *measured*, not guessed: tests/helpers/signCases.ts holds a
 * canonical observation of each sign, and anything else scoring above 0.35 on
 * it is a real near-miss for that sign. A test keeps this map and those scores
 * in step, so a newly added sign that shadows an existing one either gets fixed
 * or gets listed — it cannot quietly go unmentioned.
 *
 * Symmetric by construction: if A can be mistaken for B then B belongs in A's
 * list too, because the user who signed either one needs the other offered.
 */
export const CONFUSABLE: Record<string, readonly string[]> = {
  // The fingerspelled-letter equivalent of a minimal pair: same hand, same
  // place, separated only by how far it travels or which way it turns.
  HELLO: ['THANK-YOU', 'KNOW'],
  'THANK-YOU': ['HELLO', 'GOOD', 'BAD', 'TIRED', 'HUNGRY'],
  GOOD: ['THANK-YOU', 'STOP', 'BAD', 'AGAIN'],
  BAD: ['THANK-YOU', 'GOOD'],
  EAT: ['HOME', 'DRINK', 'SLEEP'],
  HOME: ['EAT'],
  DRINK: ['EAT', 'HUNGRY'],
  SLEEP: ['EAT'],
  DEAF: ['THINK'],
  THINK: ['DEAF', 'KNOW', 'ME', 'START'],
  KNOW: ['THINK', 'HELLO', 'FATHER'],
  FATHER: ['MOTHER', 'KNOW'],
  MOTHER: ['FATHER'],
  ME: ['YOU', 'MY', 'THINK', 'MEET', 'START', 'WHERE'],
  YOU: ['ME', 'WHERE'],
  MY: ['ME', 'PLEASE', 'HAPPY'],
  PLEASE: ['SORRY', 'MY'],
  SORRY: ['PLEASE', 'YES', 'COFFEE'],
  YES: ['SORRY', 'NO', 'WORK'],
  NO: ['YES', 'NAME', 'WHERE'],
  WHERE: ['NO', 'YOU', 'ME'],
  HUNGRY: ['THANK-YOU', 'DRINK'],
  FINE: ['FINISH'],
  STOP: ['GOOD', 'SCHOOL', 'AGAIN', 'TIRED', 'HELP'],
  SCHOOL: ['STOP', 'MORE', 'MONEY', 'SMALL', 'BOOK'],
  MORE: ['SCHOOL', 'NAME', 'MONEY'],
  MONEY: ['SCHOOL', 'MORE', 'AGAIN'],
  AGAIN: ['STOP', 'MONEY', 'GOOD'],
  WORK: ['LOVE', 'YES', 'CAR', 'MANY'],
  LOVE: ['WORK', 'MANY', 'COFFEE'],
  MANY: ['LOVE', 'WORK'],
  CAR: ['WORK'],
  COFFEE: ['LOVE', 'SORRY'],
  FINISH: ['WHAT', 'WANT', 'BIG', 'FINE'],
  WHAT: ['FINISH', 'WANT', 'WAIT'],
  WANT: ['WHAT', 'WAIT', 'BIG', 'FINISH'],
  WAIT: ['WANT', 'WHAT'],
  BIG: ['WANT', 'FINISH'],
  SMALL: ['SCHOOL'],
  NAME: ['MORE', 'NO'],
  HELP: ['STOP'],
  BOOK: ['SCHOOL'],
  TIRED: ['THANK-YOU', 'STOP'],
  MEET: ['ME'],
  START: ['ME', 'THINK'],
  HAPPY: ['MY'],
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
