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
import type { SignFrame } from '@/modes/signs/observation';
import {
  BUILT_IN_GLOSSES,
  CONFUSABLE,
  REJECTION_FLOOR,
  SIGN_TEMPLATES,
  recognizeSign,
  signHint,
} from '@/modes/signs/signTemplates';
import { SignSegmenter } from '@/modes/signs/fewShot';
import { PER_FRAME_DIM } from '@/features/window';
import { SHAPES, geometry, observation } from './helpers/geometry';

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
  flat: ['bent', 'open'],
  bent: ['flat', 'claw', 'flatO', 'c'],
  claw: ['bent', 'open', 'flatO', 'c'],
  open: ['flat', 'claw'],
  h: ['v', 'index'],
  v: ['h'],
  w: ['open', 'v', 'h'],
  index: ['h'],
  fist: ['thumbUp', 'y'],
  thumbUp: ['fist', 'y'],
  y: ['thumbUp', 'fist', 'ily'],
  ily: ['y'],
  flatO: ['c', 'bent', 'claw'],
  // A C hand and a bent-B hand are both "half-curled fingers" to a landmark
  // model. The thumb tells them apart in real life and MediaPipe rarely sees it.
  c: ['flatO', 'claw', 'bent'],
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
    dominant: { geometry: SHAPES.flat(), pos: { x, y, z: 0 }, zone: 'chest' },
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
      dominant: { geometry: SHAPES.flat(), pos: { x: 0, y: 0, z: 0 }, zone: 'chest' },
      other: { geometry: SHAPES.flat(), pos: { x: gap, y: 0, z: 0 }, zone: 'chest' },
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

    // The floor has to sit clearly between the two, not graze one of them.
    expect(bestResting).toBeLessThan(REJECTION_FLOOR - 0.1);
    expect(bestReal).toBeGreaterThan(REJECTION_FLOOR + 0.1);
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
