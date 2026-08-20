/**
 * Coverage for the pieces between landmarks and text: settings migration,
 * autocomplete, windowing, few-shot matching, and CTC decoding.
 */
import { describe, expect, it } from 'vitest';
import { migrateSettings } from '@/settings/migrate';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import { SETTINGS_VERSION, clampToRange } from '@/settings/schema';
import { Autocomplete, confusionVariants } from '@/modes/fingerspell/autocomplete';
import { PER_FRAME_DIM, WINDOW_FRAMES, motionEnergy, resampleWindow } from '@/features/window';
import { FewShotMatcher, SignSegmenter, buildPrototype } from '@/modes/signs/fewShot';
import { greedyDecode } from '@/modes/conversation/ctc';
import {
  buildPrototypes,
  leaveOneOutAccuracy,
  runLinearHead,
  trainLinearHead,
} from '@/modes/fingerspell/calibration';
import type { CalibrationSample } from '@/modes/fingerspell/calibration';
import { toPlainText, toSrt } from '@/ui/transcript';

describe('settings migration', () => {
  it('returns defaults for nothing at all', () => {
    expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('migrates a v1 blob forward to the current version', () => {
    const v1 = {
      version: 1,
      recognition: { mode: 'fingerspell', dwellMs: 800 },
      speech: { readAloud: 'letter', rate: 1.4, voiceURI: 'x' },
      display: { captionSize: 'xl', conversationMode: true },
    };
    const migrated = migrateSettings(v1);
    expect(migrated.version).toBe(SETTINGS_VERSION);
    expect(migrated.speechOut.readAloud).toBe('letter');
    expect(migrated.speechOut.rate).toBe(1.4);
    expect(migrated.speechIn.language).toBe('en-US');
    expect(migrated.experimental.conversationMode).toBe(true);
    expect(migrated.display).not.toHaveProperty('conversationMode');
  });

  it('keeps values the user had set', () => {
    const migrated = migrateSettings({ version: 1, recognition: { dwellMs: 800 } });
    expect(migrated.recognition.dwellMs).toBe(800);
  });

  it('fills in fields added since the blob was written', () => {
    const migrated = migrateSettings({ version: SETTINGS_VERSION, recognition: {} });
    expect(migrated.recognition.confidenceThreshold).toBe(
      DEFAULT_SETTINGS.recognition.confidenceThreshold,
    );
  });

  it('gives an existing install landmark smoothing rather than leaving it off', () => {
    // Anyone upgrading had no filtering at all, and no filtering is the worse
    // experience — the setting exists so people can ask for raw tracking, not
    // so they get it by accident.
    const migrated = migrateSettings({ version: 3, recognition: { dwellMs: 800 } });
    expect(migrated.recognition.landmarkSmoothing).toBe('standard');
    expect(migrated.recognition.dwellMs).toBe(800);
  });

  it('never lets a stored blob turn off on-device-only', () => {
    const migrated = migrateSettings({
      version: SETTINGS_VERSION,
      privacy: { onDeviceOnly: false },
    });
    expect(migrated.privacy.onDeviceOnly).toBe(true);
  });

  it('discards a value of the wrong type', () => {
    const migrated = migrateSettings({ version: SETTINGS_VERSION, recognition: { dwellMs: 'fast' } });
    expect(migrated.recognition.dwellMs).toBe(DEFAULT_SETTINGS.recognition.dwellMs);
  });
});

describe('clampToRange', () => {
  it('clamps below the minimum', () => {
    expect(clampToRange('confidenceThreshold', 0.01)).toBe(0.3);
  });
  it('clamps above the maximum', () => {
    expect(clampToRange('dwellMs', 99999)).toBe(1500);
  });
  it('snaps to the step', () => {
    expect(clampToRange('dwellMs', 617)).toBe(600);
  });
});

describe('autocomplete', () => {
  it('completes an exact prefix', () => {
    const words = new Autocomplete().suggest('hel').map((s) => s.word);
    expect(words).toContain('hello');
  });

  it('needs at least two letters', () => {
    expect(new Autocomplete().suggest('h')).toHaveLength(0);
  });

  it('recovers from a single confusable-letter error', () => {
    // "hoase" for "house" - the O/E confusion.
    const suggestions = new Autocomplete().suggest('hou');
    expect(suggestions.map((s) => s.word)).toContain('house');
  });

  it('marks corrected suggestions so the UI can flag them', () => {
    const suggestions = new Autocomplete().suggest('gu');
    expect(suggestions.every((s) => typeof s.corrected === 'boolean')).toBe(true);
  });

  it('learns the user’s own words and ranks them first', () => {
    const auto = new Autocomplete();
    for (let i = 0; i < 5; i++) auto.learn('helvetica');
    expect(auto.suggest('helv')[0].word).toBe('helvetica');
  });

  it('round-trips its learned words', () => {
    const auto = new Autocomplete();
    auto.learn('signbridge');
    const restored = new Autocomplete(auto.export());
    expect(restored.suggest('signb')[0].word).toBe('signbridge');
  });

  it('never suggests the prefix itself', () => {
    expect(new Autocomplete().suggest('the').map((s) => s.word)).not.toContain('the');
  });

  it('caps the number of confusion variants it explores', () => {
    expect(confusionVariants('mnstermnster').length).toBeLessThanOrEqual(24);
  });
});

describe('windowing', () => {
  const frame = (v: number) => Float32Array.from({ length: PER_FRAME_DIM }, () => v);

  it('resamples a short sequence up to the window length', () => {
    const out = resampleWindow([frame(0), frame(1)]);
    expect(out.length).toBe(WINDOW_FRAMES * PER_FRAME_DIM);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[out.length - 1]).toBeCloseTo(1, 6);
  });

  it('resamples a long sequence down to the window length', () => {
    const frames = Array.from({ length: 200 }, (_, i) => frame(i / 199));
    const out = resampleWindow(frames);
    expect(out.length).toBe(WINDOW_FRAMES * PER_FRAME_DIM);
  });

  it('makes fast and slow performances of the same trajectory match', () => {
    const slow = Array.from({ length: 90 }, (_, i) => frame(i / 89));
    const fast = Array.from({ length: 22 }, (_, i) => frame(i / 21));
    const a = resampleWindow(slow);
    const b = resampleWindow(fast);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    expect(diff / a.length).toBeLessThan(0.02);
  });

  it('returns zeros for an empty sequence', () => {
    expect(resampleWindow([]).every((v) => v === 0)).toBe(true);
  });

  it('reports no motion energy for a still hand', () => {
    expect(motionEnergy([frame(0.5), frame(0.5), frame(0.5)])).toBeCloseTo(0, 8);
  });

  it('reports motion energy when the hand moves', () => {
    expect(motionEnergy([frame(0), frame(0.4)])).toBeGreaterThan(0);
  });
});

describe('few-shot signs', () => {
  const vec = (v: number) => Float32Array.from({ length: 8 }, (_, i) => v + i * 0.01);

  it('matches the nearest prototype', () => {
    const matcher = new FewShotMatcher([
      buildPrototype('a', 'HELLO', [vec(0), vec(0.02)])!,
      buildPrototype('b', 'GOODBYE', [vec(5), vec(5.02)])!,
    ]);
    expect(matcher.match(vec(0.01))[0].label).toBe('HELLO');
  });

  it('rejects a window that resembles nothing it knows', () => {
    const matcher = new FewShotMatcher([buildPrototype('a', 'HELLO', [vec(0), vec(0.02)])!]);
    expect(matcher.match(vec(50))).toHaveLength(0);
  });

  it('returns nothing at all when no signs are recorded', () => {
    expect(new FewShotMatcher().match(vec(0))).toHaveLength(0);
  });

  it('segments a burst of movement into one window', () => {
    const segmenter = new SignSegmenter();
    const f = Float32Array.from({ length: PER_FRAME_DIM }, () => 0.1);
    // The segmenter learns what "still" looks like before it will call anything
    // a sign; see tests/signs.test.ts for why that is worth the wait.
    for (let i = 0; i < 40; i++) segmenter.push(f, 0.001);

    let completed: Float32Array[] | null = null;
    for (let i = 0; i < 12; i++) completed ??= segmenter.push(f, 0.2);
    for (let i = 0; i < 10; i++) completed ??= segmenter.push(f, 0.001);
    expect(completed).not.toBeNull();
    expect(completed!.length).toBeGreaterThanOrEqual(6);
  });

  it('stays quiet when nothing moves', () => {
    const segmenter = new SignSegmenter();
    const f = Float32Array.from({ length: PER_FRAME_DIM }, () => 0.1);
    for (let i = 0; i < 50; i++) expect(segmenter.push(f, 0.0005)).toBeNull();
  });
});

describe('CTC decoding', () => {
  it('collapses repeats and strips blanks', () => {
    const labels = ['<blank>', 'HELLO', 'WORLD'];
    // frames: HELLO HELLO <blank> HELLO WORLD
    const frames = [
      [0.01, 0.9, 0.09],
      [0.01, 0.9, 0.09],
      [0.9, 0.05, 0.05],
      [0.01, 0.9, 0.09],
      [0.01, 0.09, 0.9],
    ];
    const flat = Float32Array.from(frames.flat().map((p) => Math.log(p)));
    const out = greedyDecode(flat, frames.length, labels.length, labels);
    expect(out.map((g) => g.gloss)).toEqual(['HELLO', 'HELLO', 'WORLD']);
  });

  it('produces nothing from an all-blank stream', () => {
    const labels = ['<blank>', 'A'];
    const flat = Float32Array.from([Math.log(0.99), Math.log(0.01), Math.log(0.99), Math.log(0.01)]);
    expect(greedyDecode(flat, 2, 2, labels)).toHaveLength(0);
  });

  it('reports a span for each decoded gloss', () => {
    const labels = ['<blank>', 'A'];
    const flat = Float32Array.from([Math.log(0.1), Math.log(0.9), Math.log(0.1), Math.log(0.9)]);
    expect(greedyDecode(flat, 2, 2, labels)[0].span).toEqual([0, 2]);
  });
});

describe('local calibration training', () => {
  function sample(label: string, base: number): CalibrationSample {
    return {
      label,
      features: Float32Array.from({ length: 63 }, (_, i) => base + Math.sin(i * base) * 0.01),
      t: 0,
    };
  }

  const samples = [
    ...Array.from({ length: 6 }, () => sample('A', 0.1)),
    ...Array.from({ length: 6 }, () => sample('B', 0.9)),
  ];

  it('builds one prototype per class', () => {
    expect(buildPrototypes(samples).classes.map((c) => c.label)).toEqual(['A', 'B']);
  });

  it('fits a separable two-class problem', () => {
    const head = trainLinearHead(samples, { epochs: 200 });
    expect(head).not.toBeNull();
    expect(head!.trainAccuracy).toBe(1);
  });

  it('returns null when there is only one class', () => {
    expect(trainLinearHead([sample('A', 0.1)])).toBeNull();
  });

  it('produces a probability distribution', () => {
    const head = trainLinearHead(samples, { epochs: 50 })!;
    const probs = runLinearHead(head, samples[0].features);
    const total = [...probs].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('reports leave-one-out accuracy rather than training accuracy', () => {
    expect(leaveOneOutAccuracy(samples)).toBeGreaterThan(0.9);
  });

  it('refuses to report accuracy from too few samples', () => {
    expect(leaveOneOutAccuracy(samples.slice(0, 2))).toBe(0);
  });
});

describe('transcript export', () => {
  const tokens = [
    { text: 'hello', confidence: 0.9, id: 0 },
    { text: 'world', confidence: 0.4, id: 1 },
  ];

  it('carries the disclaimer into the file', () => {
    const text = toPlainText(tokens, Date.now());
    expect(text).toContain('not an interpretation');
  });

  it('marks low-confidence words', () => {
    expect(toPlainText(tokens, Date.now(), 0.65)).toContain('world[?]');
  });

  it('does not mark words the user corrected', () => {
    const corrected = [{ text: 'world', confidence: 0.1, id: 1, corrected: true }];
    // The header explains the [?] convention, so only the body is checked.
    const body = toPlainText(corrected, Date.now()).split('\n\n')[1];
    expect(body).not.toContain('[?]');
  });

  it('writes valid SRT timing', () => {
    const srt = toSrt(tokens, 0, 1000);
    expect(srt).toContain('00:00:00,000 --> 00:00:01,000');
    expect(srt).toContain('00:00:01,000 --> 00:00:02,000');
  });
});
