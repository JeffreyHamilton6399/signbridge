/**
 * The gloss engine is the place where "ASL is not English" either holds or
 * quietly stops holding. These tests exist to catch the regression where it
 * degrades into a per-word dictionary swap.
 */
import { describe, expect, it } from 'vitest';
import { englishToGloss, glossToString } from '@/modes/reverse/glossEngine';
import { glossToEnglish } from '@/modes/conversation/glossToEnglish';

const gloss = (text: string, available?: string[]) =>
  glossToString(englishToGloss(text, { available: available ? new Set(available) : undefined }));

describe('englishToGloss', () => {
  it('drops articles', () => {
    expect(gloss('the store')).not.toContain('THE');
  });

  it('drops the copula', () => {
    const out = gloss('I am happy');
    expect(out).not.toMatch(/\bAM\b/);
    expect(out).toContain('HAPPY');
  });

  it('moves time to the front', () => {
    const out = gloss('I go to the store tomorrow');
    expect(out.split(' ')[0]).toBe('TOMORROW');
  });

  it('marks past tense with FINISH rather than inflecting the verb', () => {
    const out = gloss('I went to the store');
    expect(out).toContain('FINISH');
    expect(out).toContain('GO');
    expect(out).not.toContain('WENT');
  });

  it('marks future with WILL', () => {
    expect(gloss('I will eat')).toContain('WILL');
  });

  it('puts negation after the verb', () => {
    const out = gloss('I do not know').split(' ');
    expect(out.indexOf('NOT')).toBeGreaterThan(out.indexOf('KNOW'));
  });

  it('moves the wh-sign to the end', () => {
    const out = gloss('where is the store').split(' ');
    expect(out.at(-1)).toBe('WHERE');
  });

  it('emits a non-manual marker for a wh-question', () => {
    const result = englishToGloss('why did you leave');
    expect(result.sentence).toBe('wh');
    expect(result.tokens.some((t) => t.kind === 'nmm')).toBe(true);
  });

  it('emits a non-manual marker for a yes/no question', () => {
    const result = englishToGloss('are you deaf?');
    expect(result.sentence).toBe('yes-no');
    expect(result.tokens.find((t) => t.kind === 'nmm')?.gloss).toContain('brows up');
  });

  it('expands pronouns to indexed signs', () => {
    expect(gloss('I see you')).toContain('IX-me');
    expect(gloss('I see you')).toContain('IX-you');
  });

  it('fingerspells anything with no clip available', () => {
    const result = englishToGloss('Cheryl works here', { available: new Set(['WORK', 'HERE']) });
    const spelled = result.tokens.filter((t) => t.kind === 'fingerspell');
    expect(spelled.map((t) => t.gloss)).toContain('FS(CHERYL)');
  });

  it('does not fingerspell when no clip set is declared', () => {
    const result = englishToGloss('Cheryl works here');
    expect(result.tokens.every((t) => t.kind !== 'fingerspell')).toBe(true);
  });

  it('explains which rules fired', () => {
    const result = englishToGloss('I went to the store yesterday');
    expect(result.notes.length).toBeGreaterThan(0);
    expect(result.notes.join(' ')).toMatch(/Time is established first/);
  });

  it('handles empty input without throwing', () => {
    expect(englishToGloss('   ').tokens).toHaveLength(0);
  });

  it('folds plurals - ASL marks number separately', () => {
    expect(gloss('the books')).toContain('BOOK');
  });
});

describe('glossToEnglish', () => {
  const g = (glosses: string[], confidence = 0.9) =>
    glossToEnglish(glosses.map((gloss) => ({ gloss, confidence })));

  it('turns FINISH into past tense on the verb', () => {
    expect(g(['FINISH', 'IX-me', 'STORE', 'GO']).text.toLowerCase()).toContain('went');
  });

  it('turns WILL into a future auxiliary', () => {
    expect(g(['WILL', 'IX-me', 'EAT']).text.toLowerCase()).toContain('will eat');
  });

  it('puts a wh-sign at the front of the English question', () => {
    const out = g(['STORE', 'WHERE']).text;
    expect(out.toLowerCase().startsWith('where')).toBe(true);
    expect(out.endsWith('?')).toBe(true);
  });

  it('renders NOT as a negated verb', () => {
    expect(g(['IX-me', 'KNOW', 'NOT']).text.toLowerCase()).toContain('do not know');
  });

  it('uses subject case for the first pronoun and object case after', () => {
    const out = g(['IX-me', 'SEE', 'IX-he']).text.toLowerCase();
    expect(out).toContain('i ');
    expect(out).toContain('him');
  });

  it('carries the lowest contributing confidence', () => {
    const result = glossToEnglish([
      { gloss: 'IX-me', confidence: 0.95 },
      { gloss: 'GO', confidence: 0.42 },
    ]);
    expect(result.confidence).toBeCloseTo(0.42, 5);
  });

  it('returns empty text for no glosses', () => {
    expect(glossToEnglish([]).text).toBe('');
  });

  it('unwraps fingerspelled tokens', () => {
    expect(g(['FS(CHERYL)', 'HELP']).text.toLowerCase()).toContain('cheryl');
  });
});

describe('round trip', () => {
  it('preserves the core content words through English -> gloss -> English', () => {
    const result = englishToGloss('I will help you tomorrow');
    const back = glossToEnglish(
      result.tokens
        .filter((t) => t.kind !== 'nmm')
        .map((t) => ({ gloss: t.gloss, confidence: 1 })),
    ).text.toLowerCase();
    expect(back).toContain('help');
    expect(back).toContain('tomorrow');
  });
});
