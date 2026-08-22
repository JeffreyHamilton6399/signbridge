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
 * This is 97 signs, not a language. It is chosen for signs that are (a) common
 * in conversation and (b) geometrically distinct from each other — which is a
 * real constraint, not a shortcut. Signs that differ only by a subtle handshape
 * the camera cannot resolve are deliberately absent, because including them
 * would mean guessing.
 *
 * Every sign here is checked against a canonical observation of itself and of
 * every other sign (tests/helpers/signCases.ts). That is what makes the list
 * safe to grow: hand-written rules collide as they multiply, and the way that
 * shows up is not a crash but one template quietly shadowing another. Four such
 * collisions existed the moment this went from 29 signs to 49, four more at 75,
 * and five more at 97. The test named every one. Do not add a sign without
 * adding its case.
 *
 * At 97 signs, 13 of them have another sign scoring above 0.5 on their own
 * canonical observation, and the tightest margin anywhere is 0.147. The space
 * that 22 handshapes, 12 body anchors, orientation and a dozen movement
 * patterns can separate is large but not unlimited; past some point coverage
 * starts being bought with precision, and the honest way to 150 is a trained
 * model. See docs/DATASETS.md.
 *
 * Accuracy is well below a trained model's and varies hugely with lighting,
 * framing and signing style. Every match carries its confidence, the rejection
 * floor means an unrecognised movement produces *nothing* rather than the
 * least-bad guess, and CONFUSABLE below names the pairs this genuinely cannot
 * separate. Do not raise the numbers by lowering the floor.
 *
 * A sign is handshape + location + movement + orientation. All four are now
 * read. Orientation arrived late, and its absence had been quietly capping what
 * could be expressed here — BOOK is two flat palms in contact, which without
 * rotation is also SCHOOL, MONEY and STOP. Location arrived properly later
 * still: it used to mean one of five horizontal bands, and now means a named
 * place on the body, which is the difference between "near your face" and "on
 * your chin".
 *
 * Non-manual markers — face and eyebrows — carry grammar this does not see at
 * all, so these are lexical guesses, not meaning. That gap is much harder than
 * the orientation one and is not on the near horizon.
 */
import { handshape } from '@/features/handshapes';
import type { HandshapeName } from '@/features/handshapes';
import { clamp01, ramp } from '@/features/handGeometry';
import type { AnchorDistances, BodyAnchor, HandTrack, SignObservation, Zone } from './observation';

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

// --- location, said properly -------------------------------------------------
//
// `inZone` asks which of five horizontal bands the hand was in. That is what
// location meant here until now, and it is a blunt instrument: WATER taps the
// chin, MOTHER touches the chin, DEAF runs from the ear to the chin, and SEE
// starts at the eye — all of which are "the face band, somewhere". Signs that
// shared a handshape with a neighbour had nothing left to stand on.
//
// These read HandTrack.reached, which is how close the working end of the hand
// came to each named place on the body (see observation.ts BodyAnchor). It is
// the difference between "near your face" and "on your chin".

/** The hand reached this place on the body at some point in the sign. */
const at = (t: HandTrack | null, anchor: BodyAnchor) =>
  t ? 1 - ramp(t.reached[anchor], 0.05, 0.2) : 0;

/** Reached at least one of these — for places that blur into each other. */
const atAny = (t: HandTrack | null, ...anchors: BodyAnchor[]) =>
  anchors.reduce((best, a) => Math.max(best, at(t, a)), 0);

/** Was at this place when the sign began, whatever it did afterwards. */
const startsAt = (t: HandTrack | null, ...anchors: BodyAnchor[]) =>
  t
    ? anchors.reduce((best, a) => Math.max(best, 1 - ramp(t.start.near[a], 0.06, 0.24)), 0)
    : 0;

/**
 * Nearer to one place than to another.
 *
 * Location in ASL is contrastive: what makes THINK the temple and not the ear
 * is that it is *nearer the temple*, not that it falls inside some absolute
 * radius. Anchors on the head sit about 0.2 shoulder widths apart, so any band
 * wide enough to tolerate a real signer overlaps its neighbours — and a hand
 * between two of them scored full marks for both. THINK, HEAR, DEAF and CRY all
 * collapsed into each other on exactly that.
 *
 * A comparison has no band to get wrong. Use it wherever two signs differ only
 * by which of two neighbouring places the hand is at.
 */
const closerTo = (d: AnchorDistances | undefined, anchor: BodyAnchor, rival: BodyAnchor) =>
  d ? ramp(d[rival] - d[anchor], 0, 0.06) : 0;

/** Was at this place when the sign ended. */
const endsAt = (t: HandTrack | null, ...anchors: BodyAnchor[]) =>
  t ? anchors.reduce((best, a) => Math.max(best, 1 - ramp(t.end.near[a], 0.06, 0.24)), 0) : 0;

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

/** Moved toward the body's midline — the opposite of {@link movedOut}. */
const movedIn = (t: HandTrack | null) => (t ? ramp(-t.net.x, 0.04, 0.32) : 0);

/**
 * Both hands travelled the same way together.
 *
 * Distinct from {@link spreadApart}, which is the hands diverging. GO is two
 * hands moving outward *in parallel*; BIG is two hands moving outward *from
 * each other*. In body space those are opposite signs of the other hand's net x,
 * and conflating them made GO and BIG the same rule.
 */
const bothMoved = (o: SignObservation, axis: 'up' | 'down' | 'out') => {
  if (!o.dominant || !o.other) return 0;
  const of = (t: HandTrack) =>
    axis === 'up' ? movedUp(t) : axis === 'down' ? movedDown(t) : ramp(t.net.x, 0.04, 0.32);
  // The non-dominant hand mirrors on x, so "out" for it is negative net x.
  const other =
    axis === 'out' ? ramp(-o.other.net.x, 0.04, 0.32) : of(o.other);
  return Math.min(of(o.dominant), other);
};

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
      startsAt(o.dominant, 'temple', 'forehead'),
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
      startsAt(o.dominant, 'chin', 'mouth'),
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
      at(o.dominant, 'mouth'),
    ]),
  ),

  S('DRINK', 'C hand at your mouth, tip it up like a cup.', (o) =>
    gated(shapeAnywhere(o.dominant, 'c'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'face'),
      at(o.dominant, 'mouth'),
    ]),
  ),

  S('WATER', 'W hand tapping your chin.', (o) =>
    gated(shapeAnywhere(o.dominant, 'w'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'face'),
      // On the chin, not merely somewhere in the face band. This is what makes
      // WATER a different sign from a W hand held up beside your head.
      at(o.dominant, 'chin'),
    ]),
  ),

  S('HOME', 'Flattened-O hand touching your cheek.', (o) =>
    gated(shapeAnywhere(o.dominant, 'flatO'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'face', 'head'),
      // The cheek specifically — which is what separates HOME from EAT, both
      // of them a flattened-O hand in the face band.
      at(o.dominant, 'cheek'),
      // And it rests there. SLEEP is the same hand closing to the same shape
      // as it falls past the same cheek, so 'held' is not strict enough to
      // separate them — a fall of 0.4 shoulder widths still scores 0.86 on it.
      stillness(o.dominant),
    ]),
  ),

  S('DEAF', 'Index finger from near your ear down to your chin.', (o) =>
    gated(shape(o.dominant, 'index'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'face', 'head'),
      // Ear to chin, in that order. The two endpoints are the sign; before
      // anchors existed this could only be stated as 'travelled a bit'.
      travelled(o.dominant, 0.28),
      startsAt(o.dominant, 'ear', 'temple'),
      // CRY starts a finger's width away, at the eye, and also ends near the
      // chin. The ear and the eye are 0.23 apart, so only the comparison
      // separates them.
      closerTo(o.dominant?.start.near, 'ear', 'eye'),
      endsAt(o.dominant, 'chin', 'mouth'),
    ]),
  ),

  S('SEE', 'V hand near your eyes, moving outward.', (o) =>
    gated(shape(o.dominant, 'v'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'face', 'head', 'neck'),
      movedOut(o.dominant),
      startsAt(o.dominant, 'eye', 'cheek'),
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
      // At the chest, not merely centred and roughly still — which is also a
      // description of THIRSTY, an index finger drawn down the throat.
      at(o.dominant, 'chest'),
    ]),
  ),

  S('YOU', 'Index finger pointing outward, away from you.', (o) =>
    gated(shape(o.dominant, 'index'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'chest', 'neck'),
      lateral(o.dominant),
      // A point does not rotate. LATER is an L hand out to the same side that
      // pivots forward, and an L scores as an index finger here.
      1 - twists(o.dominant),
    ]),
  ),

  S('YES', 'Fist nodding up and down, like a head nodding.', (o) =>
    gated(shape(o.dominant, 'fist'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'chest', 'neck'),
      repeated(o.dominant, 2),
      // A nod is vertical. BATHROOM is the same closed hand shaking the other
      // way, so the axis has to be stated rather than implied.
      ramp(o.dominant?.extent.y ?? 0, 0.1, 0.25),
      1 - ramp(o.dominant?.extent.x ?? 0, 0.12, 0.3),
      // Out in neutral space, not against the body. SELF is a closed hand
      // tapping the chest, which is otherwise the same description.
      1 - at(o.dominant, 'chest'),
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
      at(o.dominant, 'forehead'),
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
      at(o.dominant, 'forehead'),
    ]),
  ),

  S('THINK', 'Index finger touching your temple.', (o) =>
    gated(unambiguous(shape(o.dominant, 'index')), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'head'),
      stillness(o.dominant),
      atAny(o.dominant, 'temple', 'forehead'),
      // UNDERSTAND is this exact finger in this exact place, flicking upward.
      1 - movedUp(o.dominant),
      // HEAR is an index finger held at the ear, and the ear sits close enough
      // to the temple that both anchors match a hand between them. Which one is
      // nearer is the question that actually has an answer.
      closerTo(o.dominant?.reached, 'temple', 'ear'),
    ]),
  ),

  // --- at the chin and face -------------------------------------------------

  S('MOTHER', 'Open hand, thumb tapping your chin.', (o) =>
    gated(shape(o.dominant, 'open'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'face'),
      held(o.dominant),
      tapped(o.dominant),
      at(o.dominant, 'chin'),
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
      startsAt(o.dominant, 'chin', 'mouth'),
    ]),
  ),

  S('FINE', 'Open hand, thumb on your chest, moving forward and out.', (o) =>
    gated(shape(o.dominant, 'open'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'chest', 'neck'),
      movedOut(o.dominant),
      // Still open when it arrives. LIKE is this sign closing to a flattened-O.
      shape(o.dominant, 'open', 'end'),
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
      // On the chest. NOW is the same two bent hands dropping the same way in
      // neutral space, and without this the two are one sign.
      startsAt(o.dominant, 'chest'),
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
      // The arc comes inward to the waiting palm. Without this, every hand
      // resting on the other hand at chest height is AGAIN — it took NIGHT and
      // COMPUTER on the first run.
      movedIn(o.dominant),
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

  // =========================================================================
  // Second expansion. Everything below leans on body anchors and the wider
  // handshape set; most of these were not expressible before either existed,
  // because "the face band, somewhere" is not a location and half of them
  // needed an L, an F, a bent-V or a baby-O.
  // =========================================================================

  // --- at the forehead ------------------------------------------------------

  S('BOY', 'Flattened-O at your forehead, fingers closing like a cap brim.', (o) =>
    gated(shapeAnywhere(o.dominant, 'flatO'), [
      yes(!o.twoHanded),
      at(o.dominant, 'forehead'),
      tapped(o.dominant),
      held(o.dominant),
    ]),
  ),

  S('WHY', 'Fingers at your forehead, pulling away into a Y.', (o) =>
    gated(Math.max(shapeAnywhere(o.dominant, 'y'), shapeAnywhere(o.dominant, 'open')), [
      yes(!o.twoHanded),
      startsAt(o.dominant, 'forehead', 'temple'),
      movedOut(o.dominant),
      travelled(o.dominant, 0.25),
    ]),
  ),

  S('UNDERSTAND', 'Index finger flicking up at your forehead.', (o) =>
    gated(shapeAnywhere(o.dominant, 'index'), [
      yes(!o.twoHanded),
      at(o.dominant, 'forehead'),
      // THINK is the same finger in the same place, held. This one flicks.
      movedUp(o.dominant),
    ]),
  ),

  // --- at the eye, ear and nose --------------------------------------------

  S('CRY', 'Index fingers tracing tears down from your eyes.', (o) =>
    gated(shape(o.dominant, 'index'), [
      startsAt(o.dominant, 'eye'),
      closerTo(o.dominant?.start.near, 'eye', 'ear'),
      movedDown(o.dominant),
      travelled(o.dominant, 0.2),
    ]),
  ),

  S('HEAR', 'Index finger up at your ear.', (o) =>
    gated(shape(o.dominant, 'index'), [
      yes(!o.twoHanded),
      at(o.dominant, 'ear'),
      closerTo(o.dominant?.reached, 'ear', 'temple'),
      // DEAF is the same finger leaving the same ear for the chin.
      stillness(o.dominant),
      1 - endsAt(o.dominant, 'chin', 'mouth'),
    ]),
  ),

  S('FUNNY', 'Two fingers brushing down off the tip of your nose.', (o) =>
    gated(Math.max(shape(o.dominant, 'h'), shape(o.dominant, 'v')), [
      yes(!o.twoHanded),
      at(o.dominant, 'nose'),
      repeated(o.dominant, 2),
    ]),
  ),

  // --- at the mouth, chin and cheek ----------------------------------------

  S('HEARING', 'Index finger rolling forward in front of your mouth.', (o) =>
    gated(shape(o.dominant, 'index'), [
      yes(!o.twoHanded),
      at(o.dominant, 'mouth'),
      circular(o.dominant),
    ]),
  ),

  S('TELL', 'Index finger from your chin, moving out toward the listener.', (o) =>
    gated(shape(o.dominant, 'index'), [
      yes(!o.twoHanded),
      startsAt(o.dominant, 'chin', 'mouth'),
      movedOut(o.dominant),
      travelled(o.dominant, 0.25),
    ]),
  ),

  S('GIRL', 'Thumb of a closed hand running down your jaw.', (o) =>
    gated(shapeAnywhere(o.dominant, 'thumbUp'), [
      yes(!o.twoHanded),
      startsAt(o.dominant, 'cheek', 'ear'),
      movedDown(o.dominant),
      travelled(o.dominant, 0.18),
    ]),
  ),

  S('NOT', 'Thumb under your chin, flicking forward.', (o) =>
    gated(shapeAnywhere(o.dominant, 'thumbUp'), [
      yes(!o.twoHanded),
      startsAt(o.dominant, 'chin'),
      movedOut(o.dominant),
      // GIRL is the same closed hand leaving the same part of the face
      // downward. This one goes forward and out.
      1 - movedDown(o.dominant),
    ]),
  ),

  S('THIRSTY', 'Index finger drawn down the front of your throat.', (o) =>
    gated(shape(o.dominant, 'index'), [
      yes(!o.twoHanded),
      startsAt(o.dominant, 'chin', 'neck'),
      endsAt(o.dominant, 'neck', 'chest'),
      closerTo(o.dominant?.end.near, 'neck', 'chin'),
      movedDown(o.dominant),
      centred(o.dominant),
    ]),
  ),

  // --- one-handed, at the chest --------------------------------------------

  S('LIKE', 'Open hand at your chest, closing as it pulls away.', (o) =>
    gated(shapeChanges(o.dominant, 'open', 'flatO'), [
      yes(!o.twoHanded),
      startsAt(o.dominant, 'chest'),
      movedOut(o.dominant),
    ]),
  ),

  S('SELF', 'Thumb-up hand tapping forward from your chest.', (o) =>
    gated(shape(o.dominant, 'thumbUp'), [
      yes(!o.twoHanded),
      at(o.dominant, 'chest'),
      inZone(o.dominant, 'chest'),
      tapped(o.dominant),
      held(o.dominant),
    ]),
  ),

  S('WELCOME', 'Flat open hand sweeping in toward your body.', (o) =>
    gated(shape(o.dominant, 'flat'), [
      yes(!o.twoHanded),
      movedIn(o.dominant),
      endsAt(o.dominant, 'chest', 'neck'),
      travelled(o.dominant, 0.3),
      yes(!o.handsContact),
    ]),
  ),

  // --- one-handed, in neutral space ----------------------------------------

  S('YELLOW', 'Y hand out to the side, twisting.', (o) =>
    gated(shape(o.dominant, 'y'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'chest', 'neck'),
      lateral(o.dominant),
      twists(o.dominant),
    ]),
  ),

  S('FINE-OK', 'F hand held up, thumb and index in a circle.', (o) =>
    gated(unambiguous(shape(o.dominant, 'f')), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'chest', 'neck'),
      stillness(o.dominant),
    ]),
  ),

  S('WHO', 'Thumb and index pinched at your chin, opening and closing.', (o) =>
    gated(shapeAnywhere(o.dominant, 'babyO'), [
      yes(!o.twoHanded),
      at(o.dominant, 'chin'),
      repeated(o.dominant, 2),
    ]),
  ),

  // --- two-handed ----------------------------------------------------------

  S('LEARN', 'Fingers lifting off your flat palm up to your forehead.', (o) =>
    gated(Math.min(shapeAnywhere(o.dominant, 'flatO'), shape(o.other, 'flat')), [
      yes(o.twoHanded),
      movedUp(o.dominant),
      endsAt(o.dominant, 'forehead', 'temple'),
      travelled(o.dominant, 0.4),
    ]),
  ),

  S('GO', 'Both index fingers pointing forward, moving away together.', (o) =>
    gated(bothShape(o, 'index'), [
      yes(o.twoHanded),
      yes(!o.handsContact),
      bothMoved(o, 'out'),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  S('COME', 'Both index fingers drawing in toward you.', (o) =>
    gated(bothShape(o, 'index'), [
      yes(o.twoHanded),
      yes(!o.handsContact),
      movedIn(o.dominant),
      1 - bothMoved(o, 'out'),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  S('FAMILY', 'Two F hands circling out and around to meet again.', (o) =>
    gated(bothShapeAnywhere(o, 'f'), [
      yes(o.twoHanded),
      circular(o.dominant),
      inZone(o.dominant, 'chest', 'neck'),
    ]),
  ),

  S('FRIEND', 'Hooked index fingers linking, then swapping over.', (o) =>
    gated(bothShapeAnywhere(o, 'x'), [
      yes(o.twoHanded),
      yes(o.handsContact),
      repeated(o.dominant, 1),
      inZone(o.dominant, 'chest'),
    ]),
  ),

  S('SIT', 'Bent fingers of one hand perching on the fingers of the other.', (o) =>
    gated(Math.min(shape(o.dominant, 'bentV'), shape(o.other, 'h')), [
      yes(o.twoHanded),
      yes(o.handsContact),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  S('READ', 'V hand tracking down over your other flat palm.', (o) =>
    gated(Math.min(shape(o.dominant, 'v'), shape(o.other, 'flat')), [
      yes(o.twoHanded),
      movedDown(o.dominant),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  S('WRITE', 'Pinched hand drawing across your other flat palm.', (o) =>
    gated(Math.min(shapeAnywhere(o.dominant, 'babyO'), shape(o.other, 'flat')), [
      yes(o.twoHanded),
      yes(o.handsContact),
      movedOut(o.dominant),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  S('PLAY', 'Both Y hands out in front, shaking.', (o) =>
    gated(bothShape(o, 'y'), [
      yes(o.twoHanded),
      yes(!o.handsContact),
      repeated(o.dominant, 2),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  S('HOUSE', 'Flat hands making a roof, then dropping into walls.', (o) =>
    gated(bothShape(o, 'flat'), [
      yes(o.twoHanded),
      yes(o.handsContact),
      spreadApart(o),
      movedDown(o.dominant),
      startsAt(o.dominant, 'forehead', 'eye', 'temple'),
    ]),
  ),
  // --- third expansion: time, places, things, colour ------------------------

  S('PHONE', 'Y hand held up to your ear like a handset.', (o) =>
    gated(shape(o.dominant, 'y'), [
      yes(!o.twoHanded),
      at(o.dominant, 'ear'),
      stillness(o.dominant),
    ]),
  ),

  S('BLACK', 'Index finger drawn straight across your forehead.', (o) =>
    gated(shape(o.dominant, 'index'), [
      yes(!o.twoHanded),
      at(o.dominant, 'forehead'),
      movedOut(o.dominant),
      1 - movedUp(o.dominant),
      travelled(o.dominant, 0.2),
    ]),
  ),

  S('RED', 'Index finger brushing down over your lips.', (o) =>
    gated(shape(o.dominant, 'index'), [
      yes(!o.twoHanded),
      at(o.dominant, 'mouth'),
      closerTo(o.dominant?.reached, 'mouth', 'eye'),
      movedDown(o.dominant),
      1 - movedOut(o.dominant),
      // And it stays on the face. THIRSTY is the same finger leaving the same
      // place in the same direction and carrying on the length of the throat.
      endsAt(o.dominant, 'chin', 'mouth'),
    ]),
  ),

  S('HOT', 'Clawed hand at your mouth, twisting away.', (o) =>
    gated(shape(o.dominant, 'claw'), [
      yes(!o.twoHanded),
      startsAt(o.dominant, 'mouth', 'chin'),
      movedOut(o.dominant),
      twists(o.dominant),
    ]),
  ),

  S('LATER', 'L hand pivoting forward from upright.', (o) =>
    gated(shape(o.dominant, 'l'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'chest', 'neck'),
      yes(!o.handsContact),
      Math.max(twists(o.dominant), tipsDown(o.dominant)),
    ]),
  ),

  S('BLUE', 'Flat hand out to the side, shaking as it twists.', (o) =>
    gated(shape(o.dominant, 'flat'), [
      yes(!o.twoHanded),
      lateral(o.dominant),
      inZone(o.dominant, 'chest', 'neck'),
      twists(o.dominant),
      yes(!o.handsContact),
    ]),
  ),

  S('HOSPITAL', 'Two fingers drawing a cross on your shoulder.', (o) =>
    gated(shape(o.dominant, 'h'), [
      yes(!o.twoHanded),
      at(o.dominant, 'shoulder'),
      closerTo(o.dominant?.reached, 'shoulder', 'chest'),
      // NO is the same H hand moving about at neck height, which sits near
      // enough to the shoulder to satisfy "at the shoulder" outright — the two
      // scored identically, and which one won was down to array order. Being
      // nearer the shoulder than the neck is true of only one of them.
      closerTo(o.dominant?.reached, 'shoulder', 'neck'),
      travelled(o.dominant, 0.15),
    ]),
  ),

  S('BATHROOM', 'Closed hand out to the side, shaking.', (o) =>
    gated(shapeAnywhere(o.dominant, 'fist'), [
      yes(!o.twoHanded),
      lateral(o.dominant),
      inZone(o.dominant, 'chest', 'neck'),
      repeated(o.dominant, 2),
      1 - at(o.dominant, 'chest'),
      // Side to side. YES is the same closed hand shaking vertically, and
      // 'shaking' alone does not distinguish a nod from a wave.
      ramp(o.dominant?.extent.x ?? 0, 0.15, 0.35),
    ]),
  ),

  // --- two-handed, one hand as a base --------------------------------------

  S('TIME', 'Index finger tapping the back of your other wrist.', (o) =>
    gated(Math.min(shape(o.dominant, 'index'), shape(o.other, 'fist')), [
      yes(o.twoHanded),
      yes(o.contacts >= 2),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  S('DOCTOR', 'Two fingers resting on the pulse of your other wrist.', (o) =>
    gated(Math.min(shape(o.dominant, 'h'), shape(o.other, 'flat')), [
      yes(o.twoHanded),
      yes(o.handsContact),
      stillness(o.dominant),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  S('WEEK', 'Index hand sliding forward across your other palm.', (o) =>
    gated(Math.min(shape(o.dominant, 'index'), shape(o.other, 'flat')), [
      yes(o.twoHanded),
      yes(o.handsContact),
      yes(o.contacts <= 1),
      movedOut(o.dominant),
      travelled(o.dominant, 0.3),
    ]),
  ),

  S('MONTH', 'Index finger running down your other upright index.', (o) =>
    gated(bothShape(o, 'index'), [
      yes(o.twoHanded),
      yes(o.handsContact),
      movedDown(o.dominant),
      travelled(o.dominant, 0.2),
    ]),
  ),

  S('NIGHT', 'Flat hand bending down over your other flat arm.', (o) =>
    gated(Math.min(shapeAnywhere(o.dominant, 'bent'), shape(o.other, 'flat')), [
      yes(o.twoHanded),
      yes(o.handsContact),
      movedDown(o.dominant),
      inZone(o.dominant, 'waist', 'chest'),
      tipsDown(o.dominant),
    ]),
  ),

  S('MORNING', 'Flat hand rising up from under your other forearm.', (o) =>
    gated(Math.min(shape(o.dominant, 'flat'), shape(o.other, 'flat')), [
      yes(o.twoHanded),
      yes(o.handsContact),
      movedUp(o.dominant),
      travelled(o.dominant, 0.3),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  S('COMPUTER', 'C hand arcing along your other forearm.', (o) =>
    gated(Math.min(shape(o.dominant, 'c'), shape(o.other, 'flat')), [
      yes(o.twoHanded),
      yes(o.handsContact),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  S('SLOW', 'Flat hand drawing back slowly over your other hand.', (o) =>
    gated(bothShape(o, 'flat'), [
      yes(o.twoHanded),
      yes(o.handsContact),
      movedIn(o.dominant),
      travelled(o.dominant, 0.25),
      inZone(o.dominant, 'chest', 'waist'),
    ]),
  ),

  // --- two-handed, in neutral space ----------------------------------------

  S('NOW', 'Both bent hands dropping together in front of you.', (o) =>
    gated(bothShape(o, 'bent'), [
      yes(o.twoHanded),
      yes(!o.handsContact),
      bothMoved(o, 'down'),
      inZone(o.dominant, 'chest', 'waist'),
      1 - repeated(o.dominant, 2),
      // Out in front of you, not against the body — see TIRED.
      1 - startsAt(o.dominant, 'chest'),
    ]),
  ),

  S('COLD', 'Both fists drawn in and shaking.', (o) =>
    gated(bothShape(o, 'fist'), [
      yes(o.twoHanded),
      yes(!o.handsContact),
      repeated(o.dominant, 2),
      inZone(o.dominant, 'chest', 'neck'),
      1 - lateral(o.dominant),
    ]),
  ),

  S('STORE', 'Both flattened-O hands facing down, flicking outward.', (o) =>
    gated(bothShape(o, 'flatO'), [
      yes(o.twoHanded),
      yes(!o.handsContact),
      bothMoved(o, 'out'),
      inZone(o.dominant, 'chest'),
    ]),
  ),

  S('TEACHER', 'Both flattened-O hands moving out from your forehead.', (o) =>
    gated(bothShapeAnywhere(o, 'flatO'), [
      yes(o.twoHanded),
      yes(!o.handsContact),
      startsAt(o.dominant, 'forehead', 'temple'),
      bothMoved(o, 'out'),
    ]),
  ),

  S('MILK', 'Closed hand squeezing, over and over.', (o) =>
    gated(shapeAnywhere(o.dominant, 'fist'), [
      yes(!o.twoHanded),
      inZone(o.dominant, 'chest', 'waist'),
      repeated(o.dominant, 3),
      stillness(o.dominant),
      1 - lateral(o.dominant),
      1 - at(o.dominant, 'chest'),
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
  HELLO: ['KNOW', 'THANK-YOU'],
  'THANK-YOU': ['BAD', 'GOOD', 'HELLO', 'HUNGRY', 'TIRED'],
  GOOD: ['AGAIN', 'BAD', 'STOP', 'THANK-YOU'],
  EAT: ['DRINK', 'HOME', 'SLEEP'],
  DRINK: ['EAT', 'HUNGRY'],
  HOME: ['EAT', 'SLEEP'],
  DEAF: ['THINK'],
  PLEASE: ['MY', 'SORRY'],
  SORRY: ['COFFEE', 'PLEASE', 'YES'],
  MY: ['HAPPY', 'ME', 'PLEASE'],
  ME: ['MEET', 'MY', 'START', 'THINK', 'THIRSTY', 'WHERE', 'YOU'],
  YOU: ['LATER', 'ME', 'WHERE'],
  YES: ['MILK', 'NO', 'SORRY', 'WORK'],
  NO: ['HOSPITAL', 'NAME', 'WHERE', 'YES'],
  WHERE: ['ME', 'NO', 'YOU'],
  HUNGRY: ['DRINK', 'THANK-YOU'],
  STOP: ['AGAIN', 'GOOD', 'HELP', 'SCHOOL', 'TIRED'],
  HELP: ['STOP'],
  MORE: ['MONEY', 'NAME', 'SCHOOL'],
  NAME: ['MORE', 'NO'],
  SCHOOL: ['BOOK', 'MONEY', 'MORE', 'SMALL', 'STOP'],
  WORK: ['CAR', 'LOVE', 'MANY', 'YES'],
  LOVE: ['COFFEE', 'MANY', 'WORK'],
  FINISH: ['BIG', 'FINE', 'WANT', 'WHAT'],
  WHAT: ['FINISH', 'WAIT', 'WANT'],
  WANT: ['BIG', 'FINISH', 'WAIT', 'WHAT'],
  FATHER: ['KNOW', 'MOTHER'],
  KNOW: ['FATHER', 'HELLO', 'THINK'],
  THINK: ['BLACK', 'CRY', 'DEAF', 'KNOW', 'ME', 'START', 'UNDERSTAND'],
  MOTHER: ['FATHER'],
  SLEEP: ['EAT', 'HOME'],
  BAD: ['GOOD', 'THANK-YOU'],
  FINE: ['FINISH'],
  BOOK: ['SCHOOL'],
  MANY: ['LOVE', 'WORK'],
  BIG: ['FINISH', 'WANT'],
  SMALL: ['SCHOOL'],
  HAPPY: ['MY'],
  TIRED: ['NOW', 'STOP', 'THANK-YOU'],
  MEET: ['ME'],
  AGAIN: ['GOOD', 'MONEY', 'STOP'],
  START: ['ME', 'THINK'],
  MONEY: ['AGAIN', 'MORE', 'SCHOOL'],
  CAR: ['WORK'],
  COFFEE: ['LOVE', 'SORRY'],
  WAIT: ['WANT', 'WHAT'],
  UNDERSTAND: ['THINK'],
  CRY: ['RED', 'THINK'],
  THIRSTY: ['ME', 'RED'],
  BLACK: ['THINK'],
  RED: ['CRY', 'THIRSTY'],
  LATER: ['YOU'],
  HOSPITAL: ['NO'],
  NOW: ['TIRED'],
  MILK: ['YES'],
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
