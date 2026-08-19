/**
 * Word completion for fingerspelling.
 *
 * Fingerspelling recognition is error-prone in ways that are highly structured:
 * the confusions are almost always within a small cluster (M/N/S/T/E, R/U/V).
 * A completion layer that knows about those clusters recovers a lot of what the
 * classifier gets wrong - "hoase" still surfaces "house" as a suggestion.
 *
 * Ranking, in order:
 *   1. exact prefix match, by frequency
 *   2. one-substitution match inside a known confusion cluster
 *   3. user's own words always outrank dictionary words of the same tier
 */
import { COMMON_WORDS, LETTER_CONFUSIONS } from './wordlist';

export interface Suggestion {
  word: string;
  /** 0..1, higher is better. Not a probability. */
  score: number;
  /** True when the match required substituting a confusable letter. */
  corrected: boolean;
}

export class Autocomplete {
  /** word -> times the user has committed it. */
  private userWords = new Map<string, number>();
  private dictionaryRank = new Map<string, number>();

  constructor(userWords: Record<string, number> = {}) {
    COMMON_WORDS.forEach((w, i) => {
      // Later duplicates in the list keep the better (earlier) rank.
      if (!this.dictionaryRank.has(w)) this.dictionaryRank.set(w, i);
    });
    for (const [w, n] of Object.entries(userWords)) this.userWords.set(w, n);
  }

  /** Record a word the user actually committed, so it ranks higher next time. */
  learn(word: string): void {
    const w = word.trim().toLowerCase();
    if (w.length < 2) return;
    this.userWords.set(w, (this.userWords.get(w) ?? 0) + 1);
  }

  /** Serializable form for IndexedDB. */
  export(): Record<string, number> {
    return Object.fromEntries(this.userWords);
  }

  suggest(prefix: string, limit = 3): Suggestion[] {
    const p = prefix.trim().toLowerCase();
    if (p.length < 2) return [];

    const seen = new Set<string>();
    const out: Suggestion[] = [];

    const push = (word: string, score: number, corrected: boolean) => {
      if (seen.has(word) || word === p) return;
      seen.add(word);
      out.push({ word, score, corrected });
    };

    // Tier 1 - exact prefix.
    for (const [word, count] of this.userWords) {
      if (word.startsWith(p)) push(word, 1 + Math.min(count, 20) / 20, false);
    }
    for (const [word, rank] of this.dictionaryRank) {
      if (word.startsWith(p)) push(word, 1 - rank / (COMMON_WORDS.length * 2), false);
    }

    // Tier 2 - one letter substituted from a confusion cluster.
    if (out.length < limit) {
      for (const variant of confusionVariants(p)) {
        for (const [word, count] of this.userWords) {
          if (word.startsWith(variant)) push(word, 0.6 + Math.min(count, 20) / 60, true);
        }
        for (const [word, rank] of this.dictionaryRank) {
          if (word.startsWith(variant)) push(word, 0.55 - rank / (COMMON_WORDS.length * 4), true);
        }
        if (out.length >= limit * 3) break;
      }
    }

    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

/**
 * Every prefix reachable by substituting exactly one letter with a member of
 * its confusion cluster. Capped so a long prefix cannot blow up the search.
 */
export function confusionVariants(prefix: string, maxVariants = 24): string[] {
  const out: string[] = [];
  for (let i = 0; i < prefix.length && out.length < maxVariants; i++) {
    const alternatives = LETTER_CONFUSIONS[prefix[i]];
    if (!alternatives) continue;
    for (const alt of alternatives) {
      out.push(prefix.slice(0, i) + alt + prefix.slice(i + 1));
      if (out.length >= maxVariants) break;
    }
  }
  return out;
}
