/**
 * English -> ASL gloss.
 *
 * ASL is not English with different words. It has its own grammar, so this is a
 * translation step, not a dictionary lookup per word. The rules implemented here
 * are the well-documented, uncontroversial core:
 *
 *   1. TIME first          "I went yesterday"  ->  YESTERDAY IX-me GO FINISH
 *   2. drop articles       a / an / the are not signed
 *   3. drop copulas        BE-verbs are not signed
 *   4. tense as aspect     past -> FINISH, future -> WILL, no verb inflection
 *   5. negation follows    "I do not know" -> IX-me KNOW NOT
 *   6. wh-word last        "where is the store" -> STORE WHERE(wh-q)
 *   7. topic-comment       a definite object may front as the topic
 *   8. unknown -> fingerspell
 *
 * Non-manual markers are emitted as their own tokens because they are part of
 * the grammar, not decoration: a yes/no question without raised brows is not a
 * question. The renderer shows them; a clip-based output cannot really perform
 * them, and the UI says so.
 *
 * WHAT THIS IS NOT. A rule engine cannot do classifiers, spatial referencing,
 * role shift, or verb agreement through space - the things that make ASL ASL.
 * Output is labelled "approximate" everywhere it is shown. Do not remove that
 * label.
 */

export type GlossKind = 'sign' | 'fingerspell' | 'nmm' | 'number';

export interface GlossToken {
  /** The gloss, conventionally upper case. */
  gloss: string;
  kind: GlossKind;
  /** The English word or words this came from, for the alignment view. */
  source: string;
  /** True when no clip exists and it will be fingerspelled. */
  fallback?: boolean;
}

export interface GlossResult {
  tokens: GlossToken[];
  /** Sentence type, which drives the non-manual marker. */
  sentence: 'statement' | 'yes-no' | 'wh' | 'command';
  /** Rules that fired, shown in the "why" panel so the output is inspectable. */
  notes: string[];
}

// --- word classes ----------------------------------------------------------

const ARTICLES = new Set(['a', 'an', 'the']);

const COPULAS = new Set(['is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', "'s", "'re", "'m"]);

const AUXILIARIES = new Set(['do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'shall']);

const TIME_WORDS = new Set([
  'yesterday', 'today', 'tomorrow', 'now', 'later', 'tonight', 'morning', 'afternoon',
  'evening', 'week', 'month', 'year', 'daily', 'always', 'never', 'sometimes', 'soon',
  'before', 'after', 'already', 'yet', 'still', 'recently', 'monday', 'tuesday',
  'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);

const WH_WORDS: Record<string, string> = {
  who: 'WHO',
  what: 'WHAT',
  where: 'WHERE',
  when: 'WHEN',
  why: 'WHY',
  how: 'HOW',
  which: 'WHICH',
  whose: 'WHOSE',
};

const PRONOUNS: Record<string, string> = {
  i: 'IX-me',
  me: 'IX-me',
  my: 'POSS-my',
  mine: 'POSS-my',
  you: 'IX-you',
  your: 'POSS-your',
  yours: 'POSS-your',
  he: 'IX-he',
  him: 'IX-he',
  his: 'POSS-his',
  she: 'IX-she',
  her: 'POSS-her',
  it: 'IX-it',
  we: 'IX-we',
  us: 'IX-we',
  our: 'POSS-our',
  they: 'IX-they',
  them: 'IX-they',
  their: 'POSS-their',
};

const NEGATIONS = new Set(['not', "n't", 'no', 'never', 'nothing', 'none', "don't", "doesn't", "didn't", "can't", "won't", "isn't", "aren't"]);

/** Prepositions that ASL usually expresses spatially rather than lexically. */
const DROPPABLE_PREPOSITIONS = new Set(['of', 'to', 'at', 'on', 'in']);

const IRREGULAR_PAST: Record<string, string> = {
  went: 'GO', saw: 'SEE', ate: 'EAT', gave: 'GIVE', took: 'TAKE', came: 'COME',
  made: 'MAKE', said: 'SAY', told: 'TELL', knew: 'KNOW', thought: 'THINK',
  got: 'GET', found: 'FIND', left: 'LEAVE', felt: 'FEEL', met: 'MEET',
  paid: 'PAY', ran: 'RUN', sat: 'SIT', taught: 'TEACH', bought: 'BUY',
  brought: 'BRING', drove: 'DRIVE', wrote: 'WRITE', read: 'READ', slept: 'SLEEP',
};

const NUMBER_WORDS = new Set([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'twenty', 'thirty', 'forty', 'fifty', 'hundred', 'thousand',
]);

// --- tokenizing ------------------------------------------------------------

interface Word {
  raw: string;
  lower: string;
}

function tokenize(text: string): Word[] {
  return text
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .split(/\s+/)
    .map((w) => w.replace(/^[^\w'-]+|[^\w'-]+$/g, ''))
    .filter(Boolean)
    .map((raw) => ({ raw, lower: raw.toLowerCase() }));
}

function stripEnding(word: string): { stem: string; past: boolean; progressive: boolean } {
  if (IRREGULAR_PAST[word]) return { stem: IRREGULAR_PAST[word].toLowerCase(), past: true, progressive: false };
  if (/^\w{4,}ed$/.test(word)) {
    const stem = word.endsWith('ied') ? `${word.slice(0, -3)}y` : word.slice(0, -2);
    return { stem, past: true, progressive: false };
  }
  if (/^\w{4,}ing$/.test(word)) {
    return { stem: word.slice(0, -3), past: false, progressive: true };
  }
  return { stem: word, past: false, progressive: false };
}

// --- the engine ------------------------------------------------------------

export interface GlossOptions {
  /** Glosses the clip dictionary can actually render. Everything else is spelled. */
  available?: ReadonlySet<string>;
  /** Fold plural nouns to singular glosses. ASL marks number separately. */
  foldPlurals?: boolean;
}

export function englishToGloss(input: string, options: GlossOptions = {}): GlossResult {
  const { available, foldPlurals = true } = options;
  const notes: string[] = [];
  const words = tokenize(input);
  if (words.length === 0) return { tokens: [], sentence: 'statement', notes };

  // --- sentence type
  const firstLower = words[0].lower;
  const whIndex = words.findIndex((w) => WH_WORDS[w.lower]);
  let sentence: GlossResult['sentence'] = 'statement';
  if (whIndex !== -1) {
    sentence = 'wh';
    notes.push('Wh-question: the wh-sign moves to the end, with furrowed brows.');
  } else if (/[?]\s*$/.test(input) || AUXILIARIES.has(firstLower) || COPULAS.has(firstLower)) {
    sentence = 'yes-no';
    notes.push('Yes/no question: raised brows, head forward, held at the end.');
  }

  const time: GlossToken[] = [];
  const body: GlossToken[] = [];
  const trailing: GlossToken[] = [];
  let past = false;
  let future = false;
  let negated = false;

  for (let i = 0; i < words.length; i++) {
    const { raw, lower } = words[i];

    if (ARTICLES.has(lower)) {
      if (!notes.includes('Articles are not signed.')) notes.push('Articles are not signed.');
      continue;
    }
    if (COPULAS.has(lower)) {
      if (!notes.includes('The verb "to be" has no ASL equivalent and is dropped.')) {
        notes.push('The verb "to be" has no ASL equivalent and is dropped.');
      }
      continue;
    }
    if (NEGATIONS.has(lower)) {
      negated = true;
      // "never" and "nothing" carry meaning of their own; the bare negator does not.
      if (lower === 'never') time.push({ gloss: 'NEVER', kind: 'sign', source: raw });
      continue;
    }
    if (lower === 'will' || lower === 'shall' || lower === "'ll") {
      future = true;
      continue;
    }
    if (AUXILIARIES.has(lower)) {
      if (lower === 'did' || lower === 'had' || lower === 'has') past = true;
      continue;
    }

    const wh = WH_WORDS[lower];
    if (wh) {
      trailing.push({ gloss: wh, kind: 'sign', source: raw });
      continue;
    }

    const pronoun = PRONOUNS[lower];
    if (pronoun) {
      body.push({ gloss: pronoun, kind: 'sign', source: raw });
      continue;
    }

    if (TIME_WORDS.has(lower)) {
      time.push({ gloss: lower.toUpperCase(), kind: 'sign', source: raw });
      if (!notes.includes('Time is established first in ASL.')) {
        notes.push('Time is established first in ASL.');
      }
      continue;
    }

    if (NUMBER_WORDS.has(lower) || /^\d+$/.test(lower)) {
      body.push({ gloss: lower.toUpperCase(), kind: 'number', source: raw });
      continue;
    }

    if (DROPPABLE_PREPOSITIONS.has(lower) && i > 0 && i < words.length - 1) {
      continue;
    }

    // Content word.
    const { stem, past: wasPast, progressive } = stripEnding(lower);
    if (wasPast) past = true;
    if (progressive && !notes.includes('Continuous aspect is shown by repeating the sign.')) {
      notes.push('Continuous aspect is shown by repeating the sign.');
    }

    let base = stem;
    if (foldPlurals && /^\w{4,}s$/.test(base) && !/ss$/.test(base)) base = base.slice(0, -1);

    const gloss = base.toUpperCase();
    const known = !available || available.has(gloss);
    body.push({
      gloss: known ? gloss : `FS(${raw.toUpperCase()})`,
      kind: known ? 'sign' : 'fingerspell',
      source: raw,
      fallback: !known,
    });
  }

  // --- topic-comment
  // If the sentence starts with a first-person pronoun and has three or more
  // content signs, ASL commonly fronts the object as the topic.
  if (
    sentence === 'statement' &&
    body.length >= 3 &&
    body[0]?.gloss.startsWith('IX-') &&
    body[body.length - 1]?.kind === 'sign'
  ) {
    const topic = body.pop()!;
    body.unshift(topic);
    notes.push('Topic-comment: the object is established first, then commented on.');
  }

  // --- aspect markers
  if (future) {
    time.push({ gloss: 'WILL', kind: 'sign', source: 'will' });
    notes.push('Future is marked with WILL rather than a verb ending.');
  }
  if (past) {
    time.unshift({ gloss: 'FINISH', kind: 'sign', source: 'past tense' });
    notes.push('Past is marked with FINISH rather than a verb ending.');
  }
  if (negated) {
    body.push({ gloss: 'NOT', kind: 'sign', source: 'negation' });
    notes.push('Negation follows the verb, with a head shake throughout.');
  }

  const nmm: GlossToken[] = [];
  if (sentence === 'wh') nmm.push({ gloss: '(brows down, head tilt)', kind: 'nmm', source: 'wh-question' });
  if (sentence === 'yes-no') nmm.push({ gloss: '(brows up, head forward)', kind: 'nmm', source: 'yes/no question' });
  if (negated) nmm.push({ gloss: '(head shake)', kind: 'nmm', source: 'negation' });

  return { tokens: [...time, ...body, ...trailing, ...nmm], sentence, notes };
}

/** Flat gloss string, e.g. "YESTERDAY IX-me STORE GO FINISH". */
export function glossToString(result: GlossResult): string {
  return result.tokens
    .filter((t) => t.kind !== 'nmm')
    .map((t) => t.gloss)
    .join(' ');
}
