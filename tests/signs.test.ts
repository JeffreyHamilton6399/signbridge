/**
 * The built-in sign recogniser.
 *
 * Two things these tests exist to protect:
 *   1. each handshape predicate fires hardest on its own handshape
 *   2. the rejection floor genuinely rejects — a recogniser that always returns
 *      its least-bad guess is worse than one that returns nothing
 */
import { describe, expect, it } from 'vitest';
import { bestHandshape, handshape } from '@/features/handshapes';
import type { HandshapeName } from '@/features/handshapes';
import { observe, sampleFrame, zoneOf } from '@/modes/signs/observation';
import { HAND_LANDMARK } from '@/vision/types';
import type { HandFrame, Point3 } from '@/vision/types';
import type { SignFrame } from '@/modes/signs/observation';
import {
  BUILT_IN_GLOSSES,
  CONFUSABLE,
  REJECTION_FLOOR,
  SIGN_TEMPLATES,
  recognizeSign,
  signHint,
} from '@/modes/signs/signTemplates';
import { SIGN_CASES, caseFor, IDLE } from './helpers/signCases';
import { SignSegmenter } from '@/modes/signs/fewShot';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import { CONFUSION_CLUSTERS, LETTER_TEMPLATES } from '@/modes/fingerspell/letterTemplates';
import { PER_FRAME_DIM } from '@/features/window';
import { SHAPES, geometry, observation, sample } from './helpers/geometry';

describe('handshape predicates', () => {
  const names = Object.keys(SHAPES) as HandshapeName[];

  it.each(names)('%s scores highest on its own handshape', (name) => {
    const g = SHAPES[name]();
    const own = handshape(name, g);
    expect(own).toBeGreaterThan(0.55);

    // It need not be the unique maximum — h/v and flat/bent genuinely overlap —
    // but it must not lose to something structurally different.
    const structurallyDifferent: HandshapeName[] = names.filter(
      (other) =>
        other !== name &&
        !OVERLAPS[name]?.includes(other) &&
        !OVERLAPS[other]?.includes(name),
    );
    for (const other of structurallyDifferent) {
      expect(handshape(other, g)).toBeLessThan(own);
    }
  });

  it('returns 0 for a missing hand', () => {
    expect(handshape('flat', null)).toBe(0);
  });

  it('separates a fist from a flat hand decisively', () => {
    expect(handshape('flat', SHAPES.flat())).toBeGreaterThan(0.8);
    expect(handshape('flat', SHAPES.fist())).toBeLessThan(0.1);
    expect(handshape('fist', SHAPES.fist())).toBeGreaterThan(0.8);
    expect(handshape('fist', SHAPES.flat())).toBeLessThan(0.1);
  });

  it('separates V from H by finger spread alone', () => {
    expect(handshape('v', SHAPES.v())).toBeGreaterThan(handshape('h', SHAPES.v()));
    expect(handshape('h', SHAPES.h())).toBeGreaterThan(handshape('v', SHAPES.h()));
  });

  it('reports a best guess for the debug overlay', () => {
    expect(bestHandshape(SHAPES.ily())?.name).toBe('ily');
    expect(bestHandshape(null)).toBeNull();
  });
});

/** Handshapes that genuinely overlap and are not expected to outrank each other. */
const OVERLAPS: Partial<Record<HandshapeName, HandshapeName[]>> = {
  ily: ['y'],
  // A C hand and a bent-B hand are both "half-curled fingers" to a landmark
  // model. The thumb tells them apart in real life and MediaPipe rarely sees it.
  c: ['flatO', 'claw', 'bent'],
  // The second wave of handshapes. Each is an existing one plus a thumb, or an
  // existing one with a finger half-way — which is exactly the kind of
  // difference an occluded thumb and a noisy landmark cannot be trusted on.
  // Naming the overlap is the honest move; pretending these separate cleanly
  // is how the fist cluster went wrong in letterTemplates.ts.
  l: ['index', 'thumbUp', 'y'],
  index: ['h', 'l', 'x', 'babyO'],
  thumbUp: ['fist', 'y', 'l'],
  babyO: ['flatO', 'fist', 'x', 'index'],
  x: ['fist', 'index', 'babyO', 'bent', 'bentV'],
  three: ['v', 'w', 'h', 'l'],
  v: ['h', 'three', 'bentV'],
  w: ['open', 'v', 'h', 'three'],
  h: ['v', 'index', 'three', 'r'],
  r: ['h', 'v', 'index'],
  four: ['open', 'flat', 'w'],
  open: ['flat', 'claw', 'four', 'w'],
  flat: ['bent', 'open', 'four'],
  bentV: ['claw', 'v', 'x', 'bent'],
  bent: ['flat', 'claw', 'flatO', 'c', 'x', 'bentV'],
  claw: ['bent', 'open', 'flatO', 'c', 'bentV'],
  flatO: ['c', 'bent', 'claw', 'babyO'],
  fist: ['thumbUp', 'y', 'x', 'babyO'],
  y: ['thumbUp', 'fist', 'ily', 'l'],
};

describe('zones', () => {
  it('maps body-relative height to a named band', () => {
    expect(zoneOf(-1.0)).toBe('head');
    expect(zoneOf(-0.5)).toBe('face');
    expect(zoneOf(-0.2)).toBe('neck');
    expect(zoneOf(0.3)).toBe('chest');
    expect(zoneOf(1.0)).toBe('waist');
  });

  it('reports unknown when there is no body reference', () => {
    expect(zoneOf(null)).toBe('unknown');
    expect(zoneOf(NaN)).toBe('unknown');
  });
});

describe('observation', () => {
  const frame = (x: number, y: number, t: number): SignFrame => ({
    t,
    dominant: sample(SHAPES.flat(), { x, y }, 'chest'),
    other: null,
    handGap: null,
    bodyUnknown: false,
  });

  it('needs at least three frames', () => {
    expect(observe([frame(0, 0, 0), frame(0, 0, 33)])).toBeNull();
  });

  it('measures net displacement and path length', () => {
    const o = observe([frame(0, 0, 0), frame(0.2, 0, 33), frame(0.4, 0, 66)])!;
    expect(o.dominant!.net.x).toBeCloseTo(0.4, 5);
    expect(o.dominant!.path).toBeCloseTo(0.4, 5);
    expect(o.dominant!.closedness).toBeCloseTo(0, 5);
  });

  it('counts reversals for a repeated movement', () => {
    const frames = [
      frame(0, 0, 0), frame(0.3, 0, 33), frame(0, 0, 66),
      frame(0.3, 0, 99), frame(0, 0, 132),
    ];
    expect(observe(frames)!.dominant!.reversals).toBeGreaterThanOrEqual(2);
  });

  it('does not count landmark jitter as a reversal', () => {
    const frames = Array.from({ length: 12 }, (_, i) =>
      frame(i % 2 === 0 ? 0 : 0.008, 0, i * 33),
    );
    expect(observe(frames)!.dominant!.reversals).toBe(0);
  });

  it('scores a closed loop as closed and round', () => {
    const frames = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 15) * Math.PI * 2;
      return frame(Math.cos(a) * 0.2, Math.sin(a) * 0.2, i * 33);
    });
    const track = observe(frames)!.dominant!;
    expect(track.closedness).toBeGreaterThan(0.8);
    expect(track.roundness).toBeGreaterThan(0.7);
  });

  it('scores a straight line as neither closed nor round', () => {
    const frames = Array.from({ length: 10 }, (_, i) => frame(i * 0.06, 0, i * 33));
    const track = observe(frames)!.dominant!;
    expect(track.closedness).toBeLessThan(0.15);
    expect(track.roundness).toBeLessThan(0.2);
  });

  it('counts hand contacts as separate taps', () => {
    const gaps = [1.2, 0.2, 1.2, 0.2, 1.2];
    const frames: SignFrame[] = gaps.map((gap, i) => ({
      t: i * 33,
      dominant: sample(SHAPES.flat(), { x: 0, y: 0 }, 'chest'),
      other: sample(SHAPES.flat(), { x: gap, y: 0 }, 'chest'),
      handGap: gap,
      bodyUnknown: false,
    }));
    const o = observe(frames)!;
    expect(o.contacts).toBe(2);
    expect(o.handsContact).toBe(true);
    expect(o.twoHanded).toBe(true);
  });

  it('flags a missing body reference', () => {
    const frames = [0, 1, 2].map((i) => ({ ...frame(0, 0, i * 33), bodyUnknown: true }));
    expect(observe(frames)!.bodyUnknown).toBe(true);
  });
});

describe('sampleFrame', () => {
  const landmarks = Array.from({ length: 21 }, (_, i) => ({
    x: 0.4 + i * 0.001,
    y: 0.5 + i * 0.001,
    z: 0,
  }));
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.4, z: 0, visibility: 1 }));
  pose[11] = { x: 0.65, y: 0.4, z: 0, visibility: 1 }; // left shoulder
  pose[12] = { x: 0.35, y: 0.4, z: 0, visibility: 1 }; // right shoulder

  it('mirrors the scene so +x is always outward on the dominant side', () => {
    const frame = {
      t: 0,
      width: 1280,
      height: 720,
      pose,
      hands: [{ landmarks, handedness: 'Right' as const, handednessScore: 0.99 }],
    };
    const right = sampleFrame(frame, 'Right');
    const left = sampleFrame(
      { ...frame, hands: [{ ...frame.hands[0], handedness: 'Left' as const }] },
      'Left',
    );
    // The same physical position produces opposite raw x, and the flip makes
    // the two agree in sign.
    expect(Math.sign(right.dominant!.pos.x)).toBe(-Math.sign(left.dominant!.pos.x));
  });

  it('marks the body as unknown when there is no pose', () => {
    const result = sampleFrame(
      {
        t: 0,
        width: 1280,
        height: 720,
        pose: null,
        hands: [{ landmarks, handedness: 'Right', handednessScore: 0.99 }],
      },
      'Right',
    );
    expect(result.bodyUnknown).toBe(true);
    expect(result.dominant!.zone).toBe('unknown');
  });
});

describe('sign recognition', () => {
  it('refuses to guess without a body reference', () => {
    const o = observation({ dominant: { shape: SHAPES.flat(), zone: 'face' }, bodyUnknown: true });
    expect(recognizeSign(o)).toHaveLength(0);
  });

  it('refuses to guess with no hand at all', () => {
    const o = observation({ dominant: { shape: SHAPES.flat(), zone: 'face' } });
    expect(recognizeSign({ ...o, dominant: null })).toHaveLength(0);
  });

  it('returns nothing for an aimless movement', () => {
    // A relaxed hand drifting in neutral space matches nothing in particular.
    const o = observation({
      dominant: { shape: geometry(), zone: 'neck', from: { x: 0.4, y: 0 }, to: { x: 0.45, y: 0.1 } },
    });
    expect(recognizeSign(o)).toHaveLength(0);
  });

  /**
   * These three all fired before the handshape gate went in — a relaxed hand
   * resting near the face read as DRINK at 90% confidence. They are the reason
   * the gate and the rejection floor exist, so they are pinned here.
   */
  it.each([
    ['a hand resting near the face', { zone: 'face' as const, from: { x: 0.3, y: -0.5 } }],
    ['hands down and idle', { zone: 'waist' as const, from: { x: 0.3, y: 0.9 } }],
    ['a hand drifting in neutral space', { zone: 'neck' as const, from: { x: 0.4, y: 0 } }],
  ])('stays silent for %s', (_label, spec) => {
    const o = observation({ dominant: { shape: geometry(), path: 0.05, ...spec } });
    expect(recognizeSign(o)).toHaveLength(0);
  });

  it('keeps a real margin between a match and a resting hand', () => {
    const resting = observation({
      dominant: { shape: geometry(), zone: 'face', from: { x: 0.3, y: -0.5 }, path: 0.05 },
    });
    const real = observation({
      dominant: {
        shape: SHAPES.flat(),
        zone: 'head',
        from: { x: 0.1, y: -0.9 },
        to: { x: 0.6, y: -0.85 },
        path: 0.5,
      },
    });
    const bestResting = Math.max(...SIGN_TEMPLATES.map((t) => t.score(resting)));
    const bestReal = Math.max(...SIGN_TEMPLATES.map((t) => t.score(real)));

    // The floor gates whether a sign is *offered*, not whether it is written:
    // committing additionally needs the user's confidence threshold and a
    // margin over the runner-up. So the bar sits lower than it did, and what
    // matters is that a resting hand stays under it at all...
    expect(bestResting).toBeLessThan(REJECTION_FLOOR);
    // ...that a real sign clears it with room to spare...
    expect(bestReal).toBeGreaterThan(REJECTION_FLOOR + 0.2);
    // ...and that a resting hand is nowhere near being written to the
    // transcript, which is the failure that actually costs the user something.
    expect(bestResting).toBeLessThan(DEFAULT_SETTINGS.recognition.confidenceThreshold - 0.2);
  });

  it('recognises HELLO — flat hand at the head, moving outward', () => {
    const o = observation({
      dominant: {
        shape: SHAPES.flat(),
        zone: 'head',
        from: { x: 0.1, y: -0.9 },
        to: { x: 0.6, y: -0.85 },
        path: 0.5,
      },
    });
    expect(recognizeSign(o)[0].gloss).toBe('HELLO');
  });

  it('recognises YES — a nodding fist', () => {
    const o = observation({
      dominant: {
        shape: SHAPES.fist(),
        zone: 'chest',
        from: { x: 0.2, y: 0.1 },
        to: { x: 0.2, y: 0.1 },
        path: 0.6,
        reversals: 3,
        extent: { x: 0.03, y: 0.2 },
      },
    });
    expect(recognizeSign(o)[0].gloss).toBe('YES');
  });

  it('recognises I-LOVE-YOU from handshape alone', () => {
    const o = observation({ dominant: { shape: SHAPES.ily(), zone: 'chest', path: 0.05 } });
    expect(recognizeSign(o)[0].gloss).toBe('I-LOVE-YOU');
  });

  it('recognises STOP — a flat hand chopping onto the other palm', () => {
    const o = observation({
      dominant: {
        shape: SHAPES.flat(),
        zone: 'chest',
        from: { x: 0.2, y: -0.2 },
        to: { x: 0.2, y: 0.3 },
      },
      other: { shape: SHAPES.flat(), zone: 'chest' },
      handsContact: true,
      contacts: 1,
    });
    expect(recognizeSign(o)[0].gloss).toBe('STOP');
  });

  it('separates GOOD from STOP by where the movement starts', () => {
    // Identical handshapes, identical downward chop onto the other palm. The
    // only difference is that GOOD begins at the chin.
    const good = observation({
      dominant: {
        shape: SHAPES.flat(),
        startZone: 'face',
        zone: 'chest',
        from: { x: 0.2, y: -0.5 },
        to: { x: 0.2, y: 0.3 },
      },
      other: { shape: SHAPES.flat(), zone: 'chest' },
      handsContact: true,
      contacts: 1,
    });
    expect(recognizeSign(good)[0].gloss).toBe('GOOD');
  });

  it('recognises SCHOOL — flat hands clapping twice', () => {
    const o = observation({
      dominant: { shape: SHAPES.flat(), zone: 'chest', path: 0.5, reversals: 3 },
      other: { shape: SHAPES.flat(), zone: 'chest' },
      handsContact: true,
      contacts: 2,
    });
    expect(recognizeSign(o)[0].gloss).toBe('SCHOOL');
  });

  it('separates PLEASE from SORRY by handshape, not motion', () => {
    const circle = { zone: 'chest' as const, path: 0.9, closedness: 0.9, roundness: 0.85 };
    expect(recognizeSign(observation({ dominant: { ...circle, shape: SHAPES.flat() } }))[0].gloss).toBe('PLEASE');
    expect(recognizeSign(observation({ dominant: { ...circle, shape: SHAPES.fist() } }))[0].gloss).toBe('SORRY');
  });

  it('separates ME from YOU by where the hand is pointing', () => {
    const me = observation({
      dominant: { shape: SHAPES.index(), zone: 'chest', from: { x: 0.05, y: 0.2 }, path: 0.05 },
    });
    const you = observation({
      dominant: { shape: SHAPES.index(), zone: 'chest', from: { x: 0.75, y: 0.1 }, path: 0.05 },
    });
    expect(recognizeSign(me)[0].gloss).toBe('ME');
    expect(recognizeSign(you)[0].gloss).toBe('YOU');
  });

  it('never reports more confidence than the raw match supports', () => {
    const o = observation({
      dominant: {
        shape: SHAPES.flat(),
        zone: 'head',
        from: { x: 0.1, y: -0.9 },
        to: { x: 0.6, y: -0.85 },
        path: 0.5,
      },
    });
    const [best] = recognizeSign(o);
    expect(best.confidence).toBeLessThanOrEqual(best.raw + 1e-9);
  });

  it('caps the candidate list', () => {
    const o = observation({
      dominant: {
        shape: SHAPES.flat(),
        zone: 'head',
        from: { x: 0.1, y: -0.9 },
        to: { x: 0.6, y: -0.85 },
        path: 0.5,
      },
    });
    expect(recognizeSign(o, 3).length).toBeLessThanOrEqual(3);
  });
});

describe('vocabulary bookkeeping', () => {
  it('every template has a unique gloss', () => {
    expect(new Set(BUILT_IN_GLOSSES).size).toBe(BUILT_IN_GLOSSES.length);
  });

  it('every template has a usable hint', () => {
    for (const gloss of BUILT_IN_GLOSSES) {
      expect(signHint(gloss).length).toBeGreaterThan(12);
    }
  });

  it('every confusable pair names signs that actually exist', () => {
    for (const [gloss, others] of Object.entries(CONFUSABLE)) {
      expect(BUILT_IN_GLOSSES).toContain(gloss);
      for (const other of others) expect(BUILT_IN_GLOSSES).toContain(other);
    }
  });

  it('the rejection floor is high enough to mean something', () => {
    expect(REJECTION_FLOOR).toBeGreaterThan(0.3);
    expect(SIGN_TEMPLATES.length).toBeGreaterThanOrEqual(24);
  });
});

describe('segmentation', () => {
  const frame = () => Float32Array.from({ length: PER_FRAME_DIM }, () => 0.1);

  /** Feed `n` frames of a given energy, returning any completed windows. */
  function feed(
    segmenter: SignSegmenter,
    energy: number,
    n: number,
    handPresent = true,
  ): Float32Array[][] {
    const out: Float32Array[][] = [];
    for (let i = 0; i < n; i++) {
      const done = segmenter.push(frame(), energy, handPresent);
      if (done) out.push(done);
    }
    return out;
  }

  it('will not fire before it has learned the noise floor', () => {
    const segmenter = new SignSegmenter();
    // Loud from the very first frame, with no idea what "still" looks like yet.
    expect(feed(segmenter, 0.5, 10)).toHaveLength(0);
    expect(segmenter.calibrated).toBe(false);
  });

  it('learns a quiet scene and then triggers on real movement', () => {
    const segmenter = new SignSegmenter();
    feed(segmenter, 0.002, 40); // still
    expect(segmenter.calibrated).toBe(true);

    const windows = [...feed(segmenter, 0.2, 20), ...feed(segmenter, 0.002, 10)];
    expect(windows).toHaveLength(1);
    expect(windows[0].length).toBeGreaterThanOrEqual(6);
  });

  it('adapts its threshold to a noisy scene instead of firing constantly', () => {
    const quiet = new SignSegmenter();
    feed(quiet, 0.002, 40);

    const noisy = new SignSegmenter();
    // A restless signer, a shaky camera, poor lighting: the floor is higher.
    for (let i = 0; i < 60; i++) noisy.push(frame(), 0.04 + (i % 5) * 0.004, true);

    expect(noisy.startThreshold).toBeGreaterThan(quiet.startThreshold);
    // Movement that would be a sign in the quiet scene is just background here.
    expect(feed(noisy, 0.05, 30)).toHaveLength(0);
  });

  it('ignores a twitch that clears the bar but never gets going', () => {
    const segmenter = new SignSegmenter();
    feed(segmenter, 0.002, 40);
    // Just over the line, briefly — repositioning a hand, not signing.
    const windows = [...feed(segmenter, 0.014, 10), ...feed(segmenter, 0.002, 10)];
    expect(windows).toHaveLength(0);
  });

  it('ends the sign when the hand leaves frame', () => {
    const segmenter = new SignSegmenter();
    feed(segmenter, 0.002, 40);
    feed(segmenter, 0.2, 12);
    expect(segmenter.recording).toBe(true);

    const windows = feed(segmenter, 0.2, 1, false);
    expect(windows).toHaveLength(1);
    expect(segmenter.recording).toBe(false);
  });

  it('will not start a sign with no hand in frame', () => {
    const segmenter = new SignSegmenter();
    feed(segmenter, 0.002, 40);
    expect(feed(segmenter, 0.3, 20, false)).toHaveLength(0);
  });

  it('trims the trailing settle so it is not measured as part of the sign', () => {
    const segmenter = new SignSegmenter();
    feed(segmenter, 0.002, 40);
    const [window] = [...feed(segmenter, 0.2, 20), ...feed(segmenter, 0.002, 10)];
    // 20 busy frames in, minus the quiet frames that ended it.
    expect(window.length).toBeLessThan(21);
  });

  it('closes a runaway window rather than growing without bound', () => {
    const segmenter = new SignSegmenter();
    feed(segmenter, 0.002, 40);
    const windows = feed(segmenter, 0.3, 200);
    expect(windows.length).toBeGreaterThanOrEqual(1);
  });

  it('forgets the floor on recalibrate', () => {
    const segmenter = new SignSegmenter();
    feed(segmenter, 0.002, 40);
    expect(segmenter.calibrated).toBe(true);
    segmenter.recalibrate();
    expect(segmenter.calibrated).toBe(false);
  });
});

describe('the fist cluster', () => {
  /**
   * A fist letter, described the way the camera actually sees one: where the
   * fingers are, plus whatever MediaPipe claims about the thumb.
   *
   * `drape` is how many fingers lie over the thumb and `lift` is how far their
   * tips are held off the palm — both read from fingers in plain view. The
   * thumb arguments are the part that may be invention.
   */
  const fistOf = (opts: {
    drape: 0 | 1 | 2 | 3;
    lift: number;
    thumbAcross: number;
    thumbExtension?: number;
    thumbAlong?: number;
  }) => {
    const bend: [number, number, number] = [0.35, 0.35, 0.35];
    for (let i = 0; i < opts.drape; i++) bend[i] = 0.62;
    return geometry({
      ext: [opts.thumbExtension ?? 0.2, 0.05, 0.05, 0.05, 0.05],
      thumbAcross: opts.thumbAcross,
      thumbAlong: opts.thumbAlong ?? 1.2,
      knuckleBend: bend,
      tipLift: opts.lift,
    });
  };

  /** Tips pressed into the palm (A, S) versus resting on a thumb (E, T, N, M). */
  const ON_PALM = 0.15;
  const ON_THUMB = 0.34;

  const best = (g: ReturnType<typeof geometry>) =>
    [...LETTER_TEMPLATES]
      .map((t) => ({ letter: t.letter, score: t.score(g) }))
      .sort((a, b) => b.score - a.score)[0].letter;

  /**
   * A, T, N and M are the same closed fist; only the thumb moves — and in T, N
   * and M the thumb is underneath the fingers, so MediaPipe never measures it.
   * It infers one, and the inference is pulled toward the commonest fist, an A.
   *
   * So the cluster is decided by the fingers, which are visible, and the thumb
   * only refines. These pin that ordering. The cases that matter are the
   * occluded ones further down: they are the ones a real signer produces.
   */
  it('reads a thumb beside the index knuckle as A', () => {
    expect(best(fistOf({ drape: 0, lift: ON_PALM, thumbAcross: -0.1, thumbExtension: 0.6 }))).toBe('A');
  });

  it('reads one finger over the thumb as T, not A', () => {
    expect(best(fistOf({ drape: 1, lift: ON_THUMB, thumbAcross: 0.3 }))).toBe('T');
  });

  it('reads three fingers over the thumb as M, not A', () => {
    expect(best(fistOf({ drape: 3, lift: ON_THUMB, thumbAcross: 0.8 }))).toBe('M');
  });

  it('places N between T and M', () => {
    expect(best(fistOf({ drape: 2, lift: ON_THUMB, thumbAcross: 0.55 }))).toBe('N');
  });

  it('orders the cluster monotonically as fingers cover the thumb', () => {
    const order = ['A', 'T', 'N', 'M'];
    const seen = ([0, 1, 2, 3] as const).map((drape) =>
      best(
        fistOf({
          drape,
          lift: drape === 0 ? ON_PALM : ON_THUMB,
          thumbAcross: [-0.1, 0.3, 0.55, 0.8][drape],
          thumbExtension: drape === 0 ? 0.6 : 0.2,
        }),
      ),
    );
    expect(seen).toEqual(order);
  });

  /**
   * The bug this cluster keeps regressing to, and the reason for everything
   * above: the fingers say T, N or M while the hidden thumb reads as an A's.
   * The visible evidence has to win.
   */
  it('reads a T as T even when the hidden thumb reads like an A', () => {
    expect(
      best(fistOf({ drape: 1, lift: ON_THUMB, thumbAcross: 0.05, thumbExtension: 0.35, thumbAlong: 1.15 })),
    ).toBe('T');
  });

  it('reads an M as M even when the hidden thumb reads like an A', () => {
    expect(
      best(fistOf({ drape: 3, lift: ON_THUMB, thumbAcross: 0.1, thumbExtension: 0.35, thumbAlong: 1.15 })),
    ).toBe('M');
  });

  /**
   * The safety property on that inversion. Both the drape count and the tip
   * lift are reasoned from how the letters are formed rather than measured from
   * signers, so the failure that matters is them saying nothing useful. When
   * they do, the cluster has to fall back to the thumb and to A — the previous
   * behaviour — rather than inverting into a confident wrong answer.
   */
  it('falls back to A rather than inverting when the fingers say nothing', () => {
    expect(
      best(fistOf({ drape: 0, lift: ON_PALM, thumbAcross: 0.1, thumbExtension: 0.35, thumbAlong: 1.15 })),
    ).toBe('A');
  });

  it('never reads a true fist as a tucked letter, whatever the thumb says', () => {
    // Tips against the palm with nothing draped: there is no room under them
    // for a thumb, so T, N and M are all wrong however the thumb is reported.
    for (const thumbAcross of [0.3, 0.55, 0.8]) {
      expect(['T', 'N', 'M']).not.toContain(
        best(fistOf({ drape: 0, lift: ON_PALM, thumbAcross })),
      );
    }
  });

  it('still offers the rest of the cluster when it picks one', () => {
    // The correction the user needs is often not in the top three, so the UI
    // offers the cluster; that map has to stay populated for A.
    expect(CONFUSION_CLUSTERS.A).toEqual(expect.arrayContaining(['T', 'M', 'N', 'S']));
  });
});

/**
 * The fist cluster's second signal.
 *
 * Everything above keys on where the thumb tip is, and the thumb tip in T, N
 * and M is underneath the fingers — MediaPipe does not measure it, it invents
 * one, and the invention looks like an A. These pin the independent signal
 * taken from the fingers, which are in plain view: how many of them are lying
 * over the thumb, read off where each finger's bend sits.
 *
 * Reasoned from how the letters are formed, not measured from signers. It is
 * wired in as a nudge rather than a veto for exactly that reason, and these
 * tests pin the direction of the nudge, not a threshold.
 */
describe('fingers lying over the thumb', () => {
  const draped = (bends: [number, number, number], thumbAcross: number) =>
    geometry({ ext: [0.2, 0.05, 0.05, 0.05, 0.05], thumbAcross, knuckleBend: bends });

  const best = (g: ReturnType<typeof geometry>) =>
    [...LETTER_TEMPLATES]
      .map((t) => ({ letter: t.letter, score: t.score(g) }))
      .sort((a, b) => b.score - a.score)[0].letter;

  const scoreOf = (g: ReturnType<typeof geometry>, letter: string) =>
    LETTER_TEMPLATES.find((t) => t.letter === letter)!.score(g);

  const FIST: [number, number, number] = [0.35, 0.35, 0.35];
  const ONE_OVER: [number, number, number] = [0.62, 0.35, 0.35];
  const TWO_OVER: [number, number, number] = [0.62, 0.62, 0.35];
  const THREE_OVER: [number, number, number] = [0.62, 0.62, 0.62];

  it('counts one, two and three fingers over the thumb', () => {
    expect(draped(FIST, 0.4).drapedCount).toBeCloseTo(0, 1);
    expect(draped(ONE_OVER, 0.4).drapedCount).toBeCloseTo(1, 1);
    expect(draped(TWO_OVER, 0.4).drapedCount).toBeCloseTo(2, 1);
    expect(draped(THREE_OVER, 0.4).drapedCount).toBeCloseTo(3, 1);
  });

  it('shifts the T/M balance with the finger count alone', () => {
    // Thumb position held fixed, so the count is the only thing that changes.
    // Stated as a ratio because the claim is about direction, not about where
    // the two happen to cross — that depends on thumbAcross, which is the
    // measurement this signal exists to back up rather than replace.
    const one = draped(ONE_OVER, 0.5);
    const three = draped(THREE_OVER, 0.5);
    expect(scoreOf(one, 'T') / scoreOf(one, 'M')).toBeGreaterThan(
      scoreOf(three, 'T') / scoreOf(three, 'M'),
    );
  });

  it('raises M and lowers T as more fingers cover the thumb', () => {
    const one = draped(ONE_OVER, 0.5);
    const three = draped(THREE_OVER, 0.5);
    expect(scoreOf(three, 'M')).toBeGreaterThan(scoreOf(one, 'M'));
    expect(scoreOf(three, 'T')).toBeLessThan(scoreOf(one, 'T'));
  });

  it('leans away from the tucked letters when nothing is over the thumb', () => {
    const clenched = draped(FIST, 0.5);
    const covered = draped(TWO_OVER, 0.5);
    expect(scoreOf(covered, 'N')).toBeGreaterThan(scoreOf(clenched, 'N'));
  });

  it('does not override a thumb that is clearly beside the index', () => {
    // A nudge, not a veto: an unambiguous A stays an A even if the fingers
    // happen to read as draped.
    expect(best(geometry({ ext: [0.6, 0.05, 0.05, 0.05, 0.05], thumbAcross: 0, knuckleBend: TWO_OVER }))).toBe('A');
  });
});

/**
 * Every sign, against a canonical observation of itself.
 *
 * The vocabulary is hand-written geometry rules, and the way hand-written rules
 * fail as they multiply is not a crash — it is one template quietly shadowing
 * another. Somebody signs WAIT and gets WANT, and nothing anywhere reports a
 * problem.
 *
 * These caught four real collisions the moment they were written, on a
 * vocabulary that had just grown from 29 signs to 49:
 *
 *   HELLO ate THANK-YOU     — both a flat hand near the face travelling out,
 *                             and HELLO asked for strictly less. Fixed by
 *                             requiring a salute to go out and not down.
 *   EAT ate HOME            — both flattened-O at the face, separated only by
 *                             how far off-centre the hand sits.
 *   THANK-YOU tied BAD      — the same hand leaving the same chin in the same
 *                             direction. Only the palm turning over tells them
 *                             apart, which is why orientation had to exist.
 *   WANT tied BIG           — the same two claw hands travelling the same
 *                             distance in opposite directions.
 *
 * See tests/helpers/signCases.ts for what these do and do not prove. Short
 * version: they show the rules are mutually consistent, not that they work on a
 * real signer.
 */
describe('every built-in sign', () => {
  it('has a canonical observation, and no observation is orphaned', () => {
    // Adding a sign without a case here would let it skip every check below.
    expect(BUILT_IN_GLOSSES.filter((g) => !SIGN_CASES[g])).toEqual([]);
    expect(Object.keys(SIGN_CASES).filter((g) => !BUILT_IN_GLOSSES.includes(g))).toEqual([]);
  });

  it.each(BUILT_IN_GLOSSES.map((g) => [g]))('%s wins its own observation', (gloss) => {
    const scored = SIGN_TEMPLATES.map((t) => ({ gloss: t.gloss, score: t.score(caseFor(gloss)) })).sort(
      (a, b) => b.score - a.score,
    );
    expect(scored[0].gloss).toBe(gloss);
  });

  it.each(BUILT_IN_GLOSSES.map((g) => [g]))('%s is what gets offered, and clears the floor', (gloss) => {
    const candidates = recognizeSign(caseFor(gloss));
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].gloss).toBe(gloss);
    expect(candidates[0].raw).toBeGreaterThan(REJECTION_FLOOR);
  });

  /**
   * The clause that makes a sign a sign rather than a description of resting.
   *
   * MOTHER was written as "open hand, at your face, one hand, not moving" and
   * scored 0.50 on a relaxed hand resting near the face — over the rejection
   * floor, from a hand doing nothing. Every clause it had was also a true
   * statement about rest.
   *
   * So: no sign may match an idle hand, checked in every zone, because a
   * template whose conditions are all satisfied by stillness will fire on
   * stillness however good its handshape gate is.
   */
  it.each([['head'], ['face'], ['neck'], ['chest'], ['waist']] as const)(
    'stays silent for a relaxed hand idling in the %s zone',
    (zone) => {
      for (const x of [0.05, 0.3, 0.55]) {
        const idle = observation({
          dominant: { shape: IDLE(), zone, from: { x, y: 0 }, path: 0.04 },
        });
        const best = Math.max(...SIGN_TEMPLATES.map((t) => t.score(idle)));
        expect(best).toBeLessThan(REJECTION_FLOOR);
        expect(recognizeSign(idle)).toHaveLength(0);
      }
    },
  );

  /**
   * CONFUSABLE has to keep up with the vocabulary, or the correction sheet
   * stops offering the sign the user actually made. Anything scoring this close
   * to a sign's own observation is a real near-miss and must be listed.
   */
  it.each(BUILT_IN_GLOSSES.map((g) => [g]))('%s lists its real near-misses', (gloss) => {
    const near = SIGN_TEMPLATES.filter(
      (t) => t.gloss !== gloss && t.score(caseFor(gloss)) >= 0.5,
    ).map((t) => t.gloss);
    const listed = CONFUSABLE[gloss] ?? [];
    expect(near.filter((g) => !listed.includes(g))).toEqual([]);
  });

  it('names confusions symmetrically', () => {
    // Whoever signed it needs the other one offered, whichever way round the
    // recogniser got it wrong.
    for (const [gloss, others] of Object.entries(CONFUSABLE)) {
      for (const other of others) {
        expect(CONFUSABLE[other] ?? []).toContain(gloss);
      }
    }
  });
});

/**
 * Body anchors, from a pose rather than a hand-built observation.
 *
 * Everything above builds HandSamples directly, so it tests the rules and not
 * the thing that feeds them. These go through sampleFrame with a synthetic pose
 * and real hand landmarks, which is the path the app actually runs.
 *
 * The capability under test is new and was the missing half of "location":
 * MediaPipe returns the nose, eyes, ears and mouth on every frame and the
 * pipeline was discarding all of it, keeping only the two shoulders. So the
 * only thing a rule could say about WATER was "somewhere in the face band",
 * which is equally true of a W hand held beside your head.
 */
describe('body anchors', () => {
  const SHOULDER_Y = 0.5;
  const HALF_WIDTH = 0.12;

  /** A pose with a face, in image coordinates. Shoulder width is the unit. */
  function poseWithFace(): Point3[] {
    const unit = HALF_WIDTH * 2;
    const p: Point3[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: SHOULDER_Y, z: 0 }));
    const put = (i: number, x: number, y: number) => {
      p[i] = { x: 0.5 + x * unit, y: SHOULDER_Y + y * unit, z: 0, visibility: 1 } as Point3;
    };
    put(0, 0, -0.7); // nose
    // Facing the camera, the subject's left is on the viewer's right, so it
    // sits at HIGHER image x. Getting this backwards is the easiest mistake in
    // the file and it silently mirrors the whole face.
    put(2, 0.16, -0.86); // subject's left eye
    put(5, -0.16, -0.86); // subject's right eye
    put(7, 0.38, -0.78); // left ear
    put(8, -0.38, -0.78); // right ear
    put(9, 0.08, -0.56); // mouth left
    put(10, -0.08, -0.56); // mouth right
    put(11, 0.5, 0); // left shoulder
    put(12, -0.5, 0); // right shoulder
    return p;
  }

  /**
   * A hand at a given point in BODY space, for the named dominant hand.
   *
   * The conversion matters and is easy to get wrong: body +x is outward on the
   * dominant side, and for a right-dominant signer facing the camera that is
   * *lower* image x. Passing an image offset here instead is what made the ear
   * come out on the far side of the head.
   */
  function handAt(x: number, y: number, dominant: 'Left' | 'Right' = 'Right'): HandFrame {
    const unit = HALF_WIDTH * 2;
    const cx = 0.5 + x * unit * (dominant === 'Right' ? -1 : 1);
    const cy = SHOULDER_Y + y * unit;
    // Small enough that wrist and fingertips are close together; this test is
    // about where the hand is, not what shape it makes.
    const landmarks: Point3[] = Array.from({ length: 21 }, (_, i) => ({
      x: cx + (i % 3) * 0.004,
      y: cy + Math.floor(i / 3) * 0.004,
      z: 0,
    }));
    return { landmarks, world: landmarks, handedness: dominant, handednessScore: 0.99 };
  }

  const frameAt = (x: number, y: number) => ({
    t: 0,
    width: 1000,
    height: 1000,
    pose: poseWithFace(),
    hands: [handAt(x, y)],
  });

  it.each([
    ['chin', 0, -0.44],
    ['mouth', 0, -0.56],
    ['forehead', 0, -1.0],
    ['ear', 0.38, -0.78],
    ['cheek', 0.3, -0.6],
    ['chest', 0, 0.3],
  ] as const)('puts a hand at the %s nearest the %s', (anchor, x, y) => {
    const sampled = sampleFrame(frameAt(x, y), 'Right');
    expect(sampled.dominant).not.toBeNull();
    expect(sampled.dominant!.near[anchor]).toBeLessThan(0.16);
    expect(sampled.bodyUnknown).toBe(false);
  });

  it('tells the chin from the forehead, which zones alone cannot', () => {
    // Both are "the head or face band". The whole point of anchors is that
    // WATER at the chin and FATHER at the forehead stop being the same place.
    const chin = sampleFrame(frameAt(0, -0.44), 'Right').dominant!;
    const forehead = sampleFrame(frameAt(0, -1.0), 'Right').dominant!;
    expect(chin.near.chin).toBeLessThan(chin.near.forehead);
    expect(forehead.near.forehead).toBeLessThan(forehead.near.chin);
  });

  it('measures from the fingertips, not the wrist', () => {
    // A hand held below the chin with its fingers reaching up to it is at the
    // chin. Measured from the wrist it is a whole hand-length away, which is
    // how far off "near the face" was as a proxy for "touching your chin".
    const unit = HALF_WIDTH * 2;
    const wristY = SHOULDER_Y + -0.15 * unit;
    const landmarks: Point3[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: wristY, z: 0 }));
    for (const tip of [HAND_LANDMARK.INDEX_TIP, HAND_LANDMARK.MIDDLE_TIP, HAND_LANDMARK.THUMB_TIP]) {
      landmarks[tip] = { x: 0.5, y: SHOULDER_Y + -0.44 * unit, z: 0 };
    }
    const sampled = sampleFrame(
      {
        t: 0,
        width: 1000,
        height: 1000,
        pose: poseWithFace(),
        hands: [{ landmarks, world: landmarks, handedness: 'Right', handednessScore: 0.99 }],
      },
      'Right',
    );
    expect(sampled.dominant!.near.chin).toBeLessThan(0.1);
    // The wrist itself is nowhere near it.
    expect(Math.abs(sampled.dominant!.pos.y - -0.44)).toBeGreaterThan(0.25);
  });

  it('mirrors the ear to the dominant side for either handedness', () => {
    // +x is outward on the dominant side, so "the ear" is a different physical
    // ear for a left-handed signer and the rules must not have to know that.
    const right = sampleFrame(frameAt(0.38, -0.78), 'Right').dominant!;
    // Same body-space point — outward on the dominant side — which is a
    // different physical ear and a different image position for each.
    const leftFrame = { ...frameAt(0, 0), hands: [handAt(0.38, -0.78, 'Left')] };
    const left = sampleFrame(leftFrame, 'Left').dominant!;
    expect(right.near.ear).toBeLessThan(0.16);
    expect(left.near.ear).toBeLessThan(0.16);
  });

  it('falls back to assumed proportions when the face is not visible', () => {
    // Losing the mouth is no reason to stop knowing where the chest is, so the
    // fallback is per-anchor rather than all-or-nothing.
    const pose = poseWithFace().map((p, i) =>
      i < 11 ? ({ ...p, visibility: 0.1 } as Point3) : p,
    );
    const sampled = sampleFrame({ ...frameAt(0, -0.44), pose }, 'Right');
    expect(sampled.bodyUnknown).toBe(false);
    expect(sampled.dominant!.near.chin).toBeLessThan(0.2);
  });

  it('reports no anchors at all when there is no body reference', () => {
    const sampled = sampleFrame({ ...frameAt(0, -0.44), pose: null }, 'Right');
    expect(sampled.bodyUnknown).toBe(true);
    expect(sampled.dominant!.near.chin).toBeGreaterThan(1);
  });

  it('keeps the closest approach across a window, not the average', () => {
    // DEAF touches the ear and then the chin. An average would say it was never
    // quite at either.
    const frames: SignFrame[] = [
      sampleFrame(frameAt(0.38, -0.78), 'Right'),
      sampleFrame(frameAt(0.2, -0.6), 'Right'),
      sampleFrame(frameAt(0, -0.44), 'Right'),
    ];
    const track = observe(frames)!.dominant!;
    expect(track.reached.ear).toBeLessThan(0.16);
    expect(track.reached.chin).toBeLessThan(0.16);
  });
});

/**
 * When a sign is over.
 *
 * Two changes here, one for latency and one for correctness.
 *
 * **The window used to lose its own first frame.** Two consecutive busy frames
 * are required before a sign opens, so a single noisy frame cannot start one —
 * but the window was then seeded with the *second* of them and the first was
 * discarded. That frame carries where the sign began, and "where it began" is
 * load-bearing: GOOD starts at the chin, DEAF at the ear, HELLO at the temple,
 * and `startsAt` reads exactly that sample.
 *
 * **The wait after the hand stops used to be fixed.** Five quiet frames is
 * 167ms at 30fps, paid at the end of every sign. The count is generous because
 * it has to survive a pause *inside* a sign — many slow almost to a stop at a
 * direction change — but a hand that has come all the way back to its resting
 * energy has finished, and making it wait the full count is dead time.
 */
describe('segment boundaries', () => {
  const frame = (mark = 0) => new Float32Array([mark]);
  const QUIET = 0.002;

  function calibrated(): SignSegmenter {
    const segmenter = new SignSegmenter();
    for (let i = 0; i < 40; i++) segmenter.push(frame(), QUIET + Math.sin(i) * 0.0002);
    return segmenter;
  }

  /** Quiet frames needed to close, after a burst of movement. */
  function framesToClose(restEnergy: number): number {
    const segmenter = calibrated();
    for (let i = 0; i < 20; i++) segmenter.push(frame(), 0.06);
    for (let i = 0; i < 25; i++) if (segmenter.push(frame(), restEnergy)) return i + 1;
    return -1;
  }

  it('keeps the frame that started the sign', () => {
    // Frames are marked with their index. If the onset is being dropped the
    // window begins at 1.
    const segmenter = calibrated();
    for (let i = 0; i < 12; i++) segmenter.push(frame(i), 0.06);
    let window: Float32Array[] | null = null;
    for (let i = 0; i < 12 && !window; i++) window = segmenter.push(frame(99), 0);
    expect(window).not.toBeNull();
    expect(window![0][0]).toBe(0);
  });

  it('closes quickly when the hand has plainly stopped', () => {
    // Two frames, 66ms, against the 167ms it always used to take.
    expect(framesToClose(0)).toBe(2);
  });

  it('still waits the full count when the stop is ambiguous', () => {
    // This is the safety half. Energy only just under the stop threshold is
    // exactly what a mid-sign pause looks like, and it gets the original wait.
    const segmenter = calibrated();
    for (let i = 0; i < 20; i++) segmenter.push(frame(), 0.06);
    const barelyQuiet = segmenter.stopThreshold * 0.999;
    let closedAt = -1;
    for (let i = 0; i < 25; i++) if (segmenter.push(frame(), barelyQuiet)) { closedAt = i + 1; break; }
    expect(closedAt).toBe(5);
  });

  it('closes sooner the more decisively the hand stopped', () => {
    const decisive = framesToClose(0);
    const middling = framesToClose(0.005);
    expect(decisive).toBeLessThan(middling);
    expect(decisive).toBeGreaterThanOrEqual(2);
  });

  it('does not end a sign on a pause in the middle of one', () => {
    // The hand slows at a direction change without coming to rest, then carries
    // on. Ending here would cut the sign in half and recognise neither piece.
    const segmenter = calibrated();
    for (let i = 0; i < 10; i++) expect(segmenter.push(frame(), 0.06)).toBeNull();
    const pause = segmenter.stopThreshold * 0.95;
    for (let i = 0; i < 3; i++) expect(segmenter.push(frame(), pause)).toBeNull();
    for (let i = 0; i < 10; i++) expect(segmenter.push(frame(), 0.06)).toBeNull();
    expect(segmenter.recording).toBe(true);
  });

  it('still needs two busy frames to start, so one noisy frame cannot', () => {
    const segmenter = calibrated();
    expect(segmenter.push(frame(), 0.06)).toBeNull();
    expect(segmenter.recording).toBe(false);
    // A quiet frame in between clears the pair.
    segmenter.push(frame(), QUIET);
    expect(segmenter.push(frame(), 0.06)).toBeNull();
    expect(segmenter.recording).toBe(false);
  });
});
