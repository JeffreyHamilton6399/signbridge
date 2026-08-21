/**
 * One canonical observation per built-in sign.
 *
 * WHY THIS EXISTS
 * ---------------
 * The vocabulary is hand-written geometry rules, and hand-written rules
 * collide. Every sign added is a new chance to shadow one already there — and
 * the way that shows up is not a failing test, it is a user signing WAIT and
 * getting WANT, which nobody notices until someone tries it.
 *
 * So every sign gets a synthetic observation of *itself*, and one test asserts
 * that each one wins its own. That turns adding a sign from an act of hope into
 * something with a safety net: collide with an existing sign and the suite says
 * which two and in which direction.
 *
 * WHAT IT DOES NOT PROVE
 * ----------------------
 * These are idealised. A real signer produces noisier handshapes, sloppier
 * paths, and zones that wander across a boundary mid-sign. Passing here means
 * the rules are *mutually consistent* — that no two templates describe the same
 * thing — and nothing more. It is a lower bound on how bad things can be, not
 * an accuracy estimate, and the only way to get one of those is to record
 * signers.
 *
 * Where a sign genuinely cannot be told from another, the honest move is to
 * name the pair in CONFUSABLE and let the UI offer both — not to bend a
 * template until the test goes green.
 */
import type { SignObservation } from '@/modes/signs/observation';
import { geometry, observation, SHAPES } from './geometry';
import type { ObservationSpec } from './geometry';

/** A relaxed, unremarkable hand — the thing that must never match anything. */
export const IDLE = () => geometry();

/**
 * The signs, as their maker would form them.
 *
 * Positions are body-relative in shoulder widths: +x is outward on the dominant
 * side, +y is downward. Zones follow observation.ts.
 */
export const SIGN_CASES: Record<string, ObservationSpec> = {
  // --- one-handed, head and face -------------------------------------------
  HELLO: {
    dominant: { shape: SHAPES.flat(), zone: 'head', from: { x: 0.1, y: -0.9 }, to: { x: 0.6, y: -0.85 }, path: 0.5 },
  },
  KNOW: {
    dominant: { shape: SHAPES.flat(), zone: 'head', from: { x: 0.15, y: -0.9 }, path: 0.1, reversals: 2 },
  },
  FATHER: {
    dominant: { shape: SHAPES.open(), zone: 'head', from: { x: 0.1, y: -0.9 }, path: 0.1, reversals: 2 },
  },
  THINK: {
    dominant: { shape: SHAPES.index(), zone: 'head', from: { x: 0.2, y: -0.88 }, path: 0.06 },
  },
  MOTHER: {
    dominant: { shape: SHAPES.open(), zone: 'face', from: { x: 0.1, y: -0.5 }, path: 0.1, reversals: 2 },
  },
  'THANK-YOU': {
    dominant: { shape: SHAPES.flat(), zone: 'face', from: { x: 0.05, y: -0.5 }, to: { x: 0.3, y: -0.25 }, path: 0.36 },
  },
  EAT: {
    dominant: { shape: SHAPES.flatO(), zone: 'face', from: { x: 0.05, y: -0.45 }, path: 0.1, reversals: 2 },
  },
  DRINK: {
    dominant: { shape: SHAPES.c(), zone: 'face', from: { x: 0.08, y: -0.45 }, to: { x: 0.08, y: -0.55 }, path: 0.14 },
  },
  WATER: {
    dominant: { shape: SHAPES.w(), zone: 'face', from: { x: 0.06, y: -0.42 }, path: 0.1, reversals: 2 },
  },
  HOME: {
    dominant: { shape: SHAPES.flatO(), zone: 'face', from: { x: 0.46, y: -0.48 }, path: 0.08 },
  },
  DEAF: {
    dominant: { shape: SHAPES.index(), zone: 'face', startZone: 'head', from: { x: 0.4, y: -0.82 }, to: { x: 0.22, y: -0.4 }, path: 0.46 },
  },
  SEE: {
    dominant: { shape: SHAPES.v(), zone: 'face', from: { x: 0.2, y: -0.6 }, to: { x: 0.55, y: -0.55 }, path: 0.36 },
  },
  SLEEP: {
    dominant: { shape: SHAPES.open(), endShape: SHAPES.flatO(), zone: 'neck', startZone: 'face', from: { x: 0.1, y: -0.5 }, to: { x: 0.1, y: -0.1 }, path: 0.4 },
  },
  BAD: {
    dominant: { shape: SHAPES.flat(), zone: 'chest', startZone: 'face', from: { x: 0.1, y: -0.45 }, to: { x: 0.35, y: 0.1 }, path: 0.6, palmTurn: -0.9, pointTurn: -1.1 },
  },

  // --- one-handed, chest ---------------------------------------------------
  PLEASE: {
    dominant: { shape: SHAPES.flat(), zone: 'chest', from: { x: 0.1, y: 0.2 }, path: 0.8, closedness: 0.85, roundness: 0.8 },
  },
  SORRY: {
    dominant: { shape: SHAPES.fist(), zone: 'chest', from: { x: 0.1, y: 0.2 }, path: 0.8, closedness: 0.85, roundness: 0.8 },
  },
  MY: {
    dominant: { shape: SHAPES.flat(), zone: 'chest', from: { x: 0.05, y: 0.15 }, path: 0.05 },
  },
  ME: {
    dominant: { shape: SHAPES.index(), zone: 'chest', from: { x: 0.02, y: 0.15 }, path: 0.12 },
  },
  YOU: {
    dominant: { shape: SHAPES.index(), zone: 'chest', from: { x: 0.45, y: 0.05 }, to: { x: 0.7, y: 0.05 }, path: 0.26 },
  },
  FINE: {
    dominant: { shape: SHAPES.open(), zone: 'chest', from: { x: 0.05, y: 0.1 }, to: { x: 0.42, y: 0.02 }, path: 0.4 },
  },
  HUNGRY: {
    dominant: { shape: SHAPES.c(), zone: 'chest', from: { x: 0.05, y: -0.1 }, to: { x: 0.05, y: 0.45 }, path: 0.56 },
  },
  YES: {
    dominant: { shape: SHAPES.fist(), zone: 'chest', from: { x: 0.35, y: -0.05 }, path: 0.35, reversals: 3 },
  },
  NO: {
    dominant: { shape: SHAPES.h(), zone: 'chest', from: { x: 0.35, y: -0.05 }, path: 0.2, reversals: 2 },
  },
  WHERE: {
    dominant: { shape: SHAPES.index(), zone: 'neck', from: { x: 0.4, y: -0.2 }, path: 0.4, reversals: 3, extent: { x: 0.28, y: 0.03 } },
  },
  'I-LOVE-YOU': {
    dominant: { shape: SHAPES.ily(), zone: 'chest', from: { x: 0.45, y: -0.1 }, path: 0.06 },
  },

  // --- two-handed ----------------------------------------------------------
  STOP: {
    dominant: { shape: SHAPES.flat(), zone: 'chest', from: { x: 0.2, y: -0.1 }, to: { x: 0.2, y: 0.25 }, path: 0.36 },
    other: { shape: SHAPES.flat(), zone: 'chest', from: { x: -0.1, y: 0.28 }, path: 0.03 },
    handsContact: true,
    contacts: 1,
  },
  GOOD: {
    dominant: { shape: SHAPES.flat(), zone: 'chest', startZone: 'face', from: { x: 0.05, y: -0.45 }, to: { x: 0.1, y: 0.25 }, path: 0.72 },
    other: { shape: SHAPES.flat(), zone: 'chest', from: { x: -0.05, y: 0.28 }, path: 0.03 },
    handsContact: true,
    contacts: 1,
  },
  HELP: {
    dominant: { shape: SHAPES.thumbUp(), zone: 'chest', from: { x: 0.05, y: 0.3 }, to: { x: 0.05, y: -0.05 }, path: 0.36 },
    other: { shape: SHAPES.flat(), zone: 'chest', from: { x: -0.05, y: 0.3 }, to: { x: -0.05, y: -0.02 }, path: 0.33 },
    handsContact: true,
    contacts: 1,
  },
  MORE: {
    dominant: { shape: SHAPES.flatO(), zone: 'chest', from: { x: 0.15, y: 0.1 }, path: 0.2, reversals: 3 },
    other: { shape: SHAPES.flatO(), zone: 'chest', from: { x: -0.15, y: 0.1 }, path: 0.2, reversals: 3 },
    handsContact: true,
    contacts: 2,
  },
  NAME: {
    dominant: { shape: SHAPES.h(), zone: 'chest', from: { x: 0.1, y: 0.05 }, path: 0.15, reversals: 2 },
    other: { shape: SHAPES.h(), zone: 'chest', from: { x: -0.05, y: 0.12 }, path: 0.04 },
    handsContact: true,
    contacts: 2,
  },
  SCHOOL: {
    dominant: { shape: SHAPES.flat(), zone: 'chest', from: { x: 0.2, y: 0.1 }, path: 0.3, reversals: 2 },
    other: { shape: SHAPES.flat(), zone: 'chest', from: { x: -0.1, y: 0.1 }, path: 0.05 },
    handsContact: true,
    contacts: 2,
  },
  WORK: {
    dominant: { shape: SHAPES.fist(), zone: 'chest', from: { x: 0.1, y: 0.2 }, path: 0.24, reversals: 2 },
    other: { shape: SHAPES.fist(), zone: 'chest', from: { x: -0.05, y: 0.3 }, path: 0.03 },
    handsContact: true,
    contacts: 2,
  },
  LOVE: {
    dominant: { shape: SHAPES.fist(), zone: 'chest', from: { x: 0.1, y: 0.05 }, path: 0.05 },
    other: { shape: SHAPES.fist(), zone: 'chest', from: { x: -0.1, y: 0.05 }, path: 0.05 },
    handsContact: true,
    contacts: 1,
  },
  FINISH: {
    dominant: { shape: SHAPES.open(), zone: 'chest', from: { x: 0.1, y: 0.0 }, to: { x: 0.45, y: 0.05 }, path: 0.38, extent: { x: 0.35, y: 0.06 } },
    other: { shape: SHAPES.open(), zone: 'chest', from: { x: -0.1, y: 0.0 }, to: { x: -0.45, y: 0.05 }, path: 0.38, extent: { x: 0.35, y: 0.06 } },
  },
  WHAT: {
    dominant: { shape: SHAPES.open(), zone: 'waist', from: { x: 0.25, y: 0.7 }, path: 0.24, reversals: 4, extent: { x: 0.1, y: 0.05 } },
    other: { shape: SHAPES.open(), zone: 'waist', from: { x: -0.25, y: 0.7 }, path: 0.24, reversals: 4, extent: { x: 0.1, y: 0.05 } },
  },
  WANT: {
    dominant: { shape: SHAPES.claw(), zone: 'chest', from: { x: 0.5, y: 0.2 }, to: { x: 0.22, y: 0.25 }, path: 0.3 },
    other: { shape: SHAPES.claw(), zone: 'chest', from: { x: -0.5, y: 0.2 }, to: { x: -0.22, y: 0.25 }, path: 0.3 },
  },
  BOOK: {
    dominant: { shape: SHAPES.flat(), zone: 'chest', from: { x: 0.12, y: 0.25 }, to: { x: 0.3, y: 0.25 }, path: 0.2, palmTurn: 1.0 },
    other: { shape: SHAPES.flat(), zone: 'chest', from: { x: -0.12, y: 0.25 }, to: { x: -0.3, y: 0.25 }, path: 0.2, palmTurn: 1.0 },
    handsContact: true,
    contacts: 1,
  },
  MANY: {
    dominant: { shape: SHAPES.fist(), endShape: SHAPES.open(), zone: 'chest', from: { x: 0.2, y: 0.0 }, to: { x: 0.32, y: 0.0 }, path: 0.14 },
    other: { shape: SHAPES.fist(), endShape: SHAPES.open(), zone: 'chest', from: { x: -0.2, y: 0.0 }, to: { x: -0.32, y: 0.0 }, path: 0.14 },
  },
  BIG: {
    dominant: { shape: SHAPES.claw(), zone: 'chest', from: { x: 0.1, y: 0.0 }, to: { x: 0.55, y: 0.0 }, path: 0.46 },
    other: { shape: SHAPES.claw(), zone: 'chest', from: { x: -0.1, y: 0.0 }, to: { x: -0.55, y: 0.0 }, path: 0.46 },
  },
  SMALL: {
    dominant: { shape: SHAPES.flat(), zone: 'chest', from: { x: 0.45, y: 0.2 }, to: { x: 0.12, y: 0.2 }, path: 0.34 },
    other: { shape: SHAPES.flat(), zone: 'chest', from: { x: -0.45, y: 0.2 }, to: { x: -0.12, y: 0.2 }, path: 0.34 },
  },
  HAPPY: {
    dominant: { shape: SHAPES.flat(), zone: 'chest', from: { x: 0.12, y: 0.3 }, to: { x: 0.12, y: 0.0 }, path: 0.5, reversals: 3 },
    other: { shape: SHAPES.flat(), zone: 'chest', from: { x: -0.12, y: 0.3 }, to: { x: -0.12, y: 0.0 }, path: 0.5, reversals: 3 },
  },
  TIRED: {
    dominant: { shape: SHAPES.bent(), zone: 'chest', from: { x: 0.15, y: -0.05 }, to: { x: 0.15, y: 0.35 }, path: 0.42 },
    other: { shape: SHAPES.bent(), zone: 'chest', from: { x: -0.15, y: -0.05 }, to: { x: -0.15, y: 0.35 }, path: 0.42 },
  },
  MEET: {
    dominant: { shape: SHAPES.index(), zone: 'chest', from: { x: 0.42, y: 0.0 }, to: { x: 0.1, y: 0.0 }, path: 0.33 },
    other: { shape: SHAPES.index(), zone: 'chest', from: { x: -0.42, y: 0.0 }, to: { x: -0.1, y: 0.0 }, path: 0.33 },
    handsContact: true,
    contacts: 1,
  },
  AGAIN: {
    dominant: { shape: SHAPES.bent(), zone: 'chest', from: { x: 0.4, y: 0.05 }, to: { x: 0.02, y: 0.25 }, path: 0.5 },
    other: { shape: SHAPES.flat(), zone: 'chest', from: { x: -0.08, y: 0.28 }, path: 0.03 },
    handsContact: true,
    contacts: 1,
  },
  START: {
    dominant: { shape: SHAPES.index(), zone: 'chest', from: { x: 0.05, y: 0.22 }, path: 0.07, palmTurn: 0.9 },
    other: { shape: SHAPES.flat(), zone: 'chest', from: { x: -0.05, y: 0.25 }, path: 0.03 },
    handsContact: true,
    contacts: 1,
  },
  MONEY: {
    dominant: { shape: SHAPES.flatO(), zone: 'chest', from: { x: 0.08, y: 0.2 }, path: 0.22, reversals: 2 },
    other: { shape: SHAPES.flat(), zone: 'chest', from: { x: -0.08, y: 0.28 }, path: 0.03 },
    handsContact: true,
    contacts: 2,
  },
  CAR: {
    dominant: { shape: SHAPES.fist(), zone: 'waist', from: { x: 0.3, y: 0.55 }, path: 0.35, reversals: 3 },
    other: { shape: SHAPES.fist(), zone: 'waist', from: { x: -0.3, y: 0.55 }, path: 0.35, reversals: 3 },
  },
  COFFEE: {
    dominant: { shape: SHAPES.fist(), zone: 'chest', from: { x: 0.05, y: 0.15 }, path: 0.8, closedness: 0.85, roundness: 0.85 },
    other: { shape: SHAPES.fist(), zone: 'chest', from: { x: -0.02, y: 0.35 }, path: 0.04 },
  },
  WAIT: {
    dominant: { shape: SHAPES.claw(), zone: 'waist', from: { x: 0.3, y: 0.65 }, path: 0.18, reversals: 3 },
    other: { shape: SHAPES.claw(), zone: 'waist', from: { x: -0.05, y: 0.7 }, path: 0.18, reversals: 3 },
  },
};

export function caseFor(gloss: string): SignObservation {
  const spec = SIGN_CASES[gloss];
  if (!spec) throw new Error(`No canonical observation for ${gloss}`);
  return observation(spec);
}
