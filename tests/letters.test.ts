/**
 * Every letter, against a canonical hand of itself.
 *
 * The sign vocabulary got this treatment first and it found nine collisions
 * across three batches. The 24 letter templates are the same kind of code and
 * had never had it: the fist cluster was checked, because that is where the
 * complaints came from, and the other eighteen letters were on trust.
 *
 * On trust turned out to mean this — every one a pair whose *entire* distinction
 * is a single predicate, and the single predicate was being averaged away:
 *
 *   Q scored 0.92 on a G   (differ only by which way the hand points)
 *   K scored 0.82 on a V   (differ only by the thumb)
 *   A scored 0.80 on an X  (differ only by one half-curled finger)
 *   R scored 0.74 on a U   (differ only by whether they are crossed)
 *
 * See `combine` in letterTemplates.ts for the cause and the fix. The numbers
 * after it are Q 0.02, K 0.51, A 0.53, R 0.40.
 *
 * WHAT THIS DOES NOT PROVE. Idealised geometries, built directly rather than
 * run through MediaPipe. Mutual consistency of the rules, not accuracy on a
 * real hand — the same caveat as tests/helpers/signCases.ts, and for the same
 * reason.
 */
import { describe, expect, it } from 'vitest';
import { LETTER_CASES, letterCase } from './helpers/letterCases';
import { geometry } from './helpers/geometry';
import {
  CONFUSION_CLUSTERS,
  FIST_CLUSTER,
  LETTER_TEMPLATES,
  STATIC_LETTERS,
} from '@/modes/fingerspell/letterTemplates';
import { DEFAULT_DWELL, dwellScale } from '@/modes/fingerspell/debouncer';

/** Everything scored against one hand, best first. */
function ranked(g: ReturnType<typeof letterCase>) {
  return LETTER_TEMPLATES.map((t) => ({ letter: t.letter, score: t.score(g) })).sort(
    (a, b) => b.score - a.score,
  );
}

describe('every static letter', () => {
  it('has a canonical hand, and no hand is orphaned', () => {
    expect(STATIC_LETTERS.filter((l) => !LETTER_CASES[l])).toEqual([]);
    expect(Object.keys(LETTER_CASES).filter((l) => !STATIC_LETTERS.includes(l as never))).toEqual(
      [],
    );
  });

  it.each(STATIC_LETTERS.map((l) => [l]))('%s wins its own hand', (letter) => {
    expect(ranked(letterCase(letter))[0].letter).toBe(letter);
  });

  it.each(STATIC_LETTERS.map((l) => [l]))('%s is recognised with real confidence', (letter) => {
    // Winning is not enough: a letter that only ever scores 0.4 will never
    // clear the commit threshold, so it is not recognised in any useful sense.
    const own = ranked(letterCase(letter)).find((r) => r.letter === letter)!;
    expect(own.score).toBeGreaterThan(0.8);
  });

  /**
   * A clause that clearly fails must be close to fatal.
   *
   * This is the property `combine` exists to provide, stated directly rather
   * than through its consequences. Under a plain geometric mean a letter could
   * fail its single defining predicate outright and still score 0.82, which is
   * over the default commit threshold — the app would have written the wrong
   * letter with no hesitation at all.
   */
  it('is ruled out by one decisively failed clause', () => {
    // K and V are the same two fingers in the same place pointing the same way;
    // the thumb is the whole difference, and it is one clause out of eight.
    const k = LETTER_TEMPLATES.find((t) => t.letter === 'K')!;
    expect(k.score(letterCase('K'))).toBeGreaterThan(0.9);
    expect(k.score(letterCase('V'))).toBeLessThan(0.6);
  });

  /**
   * CONFUSION_CLUSTERS drives what the correction sheet offers. If a letter
   * genuinely fires on another letter's hand, the user who made that hand needs
   * it in the list — otherwise the fix is not one tap away, which is the whole
   * premise of shipping a recogniser this uncertain.
   */
  it.each(STATIC_LETTERS.map((l) => [l]))('%s lists the letters that fire on it', (letter) => {
    const near = ranked(letterCase(letter))
      .filter((r) => r.letter !== letter && r.score >= 0.5)
      .map((r) => r.letter);
    const listed = CONFUSION_CLUSTERS[letter] ?? [];
    expect(near.filter((l) => !listed.includes(l))).toEqual([]);
  });

  it('names confusions symmetrically', () => {
    for (const [letter, others] of Object.entries(CONFUSION_CLUSTERS)) {
      for (const other of others) {
        expect(CONFUSION_CLUSTERS[other] ?? []).toContain(letter);
      }
    }
  });

  /**
   * A relaxed, half-open hand is not a letter.
   *
   * The signs mode learned this the hard way — a template whose clauses are all
   * satisfied by a hand doing nothing will fire on a hand doing nothing. The
   * letter path has a separate guard in scanQuality.ts, but the templates
   * themselves should not be handing it a confident wrong answer to suppress.
   */
  it('does not confidently name a relaxed hand', () => {
    const best = ranked(geometry())[0];
    expect(best.score).toBeLessThan(0.65);
  });
});

/**
 * The two halves together: how sure the classifier is, and how long that makes
 * the app wait.
 *
 * These are separate mechanisms — `combine` decides the raw score,
 * TEMPLATE_TEMPERATURE turns scores into a distribution, and `dwellScale` turns
 * the distribution into a wait. They compound, and in the right direction:
 * making one letter's clauses decisive widens its margin over the runner-up,
 * which sharpens the softmax, which shortens the dwell. Accuracy work bought
 * speed for free.
 *
 * On idealised hands the alphabet averages well under half the nominal dwell,
 * and the letters that stay slow are the fist cluster — which is correct, and
 * is the point of making dwell adaptive rather than just shorter.
 *
 * Real hands score lower than these and will commit more slowly. The ratio is
 * the claim here, not the milliseconds.
 */
describe('confidence and commit time across the alphabet', () => {
  const TEMPERATURE = 0.085;

  function distributionFor(letter: string) {
    const raw = LETTER_TEMPLATES.map((t) => t.score(letterCase(letter)));
    const max = Math.max(...raw);
    const exps = raw.map((v) => Math.exp((v - max) / TEMPERATURE));
    const sum = exps.reduce((a, b) => a + b, 0);
    return LETTER_TEMPLATES.map((t, i) => ({ letter: t.letter, p: exps[i] / sum })).sort(
      (a, b) => b.p - a.p,
    );
  }

  it.each(STATIC_LETTERS.map((l) => [l]))('%s clears the default commit threshold', (letter) => {
    const top = distributionFor(letter);
    expect(top[0].letter).toBe(letter);
    expect(top[0].p).toBeGreaterThan(DEFAULT_DWELL.confidenceThreshold);
  });

  it('commits the alphabet in well under the nominal dwell on average', () => {
    const times = STATIC_LETTERS.map((letter) => {
      const [best, runnerUp] = distributionFor(letter);
      return (
        DEFAULT_DWELL.dwellMs *
        dwellScale(best.p, best.p - runnerUp.p, DEFAULT_DWELL.confidenceThreshold)
      );
    });
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    expect(mean).toBeLessThan(DEFAULT_DWELL.dwellMs * 0.6);
  });

  it('spends its extra time on the fist cluster and nowhere else', () => {
    // A letter taking longer than the nominal dwell is the mechanism working,
    // but only for letters that are genuinely ambiguous. Anywhere else it is a
    // template that has stopped being decisive.
    const slow = STATIC_LETTERS.filter((letter) => {
      const [best, runnerUp] = distributionFor(letter);
      return dwellScale(best.p, best.p - runnerUp.p, DEFAULT_DWELL.confidenceThreshold) > 1;
    });
    expect(slow.filter((l) => !FIST_CLUSTER.includes(l as never))).toEqual([]);
  });
});
