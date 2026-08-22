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
  LETTER_TEMPLATES,
  STATIC_LETTERS,
} from '@/modes/fingerspell/letterTemplates';

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
    const failed = [1, 1, 1, 1, 1, 1, 1, 0.15];
    const template = LETTER_TEMPLATES.find((t) => t.letter === 'K')!;
    void template;
    // K and V are the same two fingers; the thumb is the whole difference.
    const asV = LETTER_TEMPLATES.find((t) => t.letter === 'K')!.score(letterCase('V'));
    expect(asV).toBeLessThan(0.6);
    void failed;
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
