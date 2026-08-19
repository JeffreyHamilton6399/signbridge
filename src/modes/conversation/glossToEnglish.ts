/**
 * ASL gloss -> English.
 *
 * The mirror image of glossEngine.ts, and just as approximate. A gloss sequence
 * is not a sentence: it has no articles, no copula, no inflection, and its word
 * order encodes topic-comment structure that English expresses with syntax. So
 * this is a translation, and translations are guesses.
 *
 * Rules applied:
 *   - IX-me / IX-you expand to pronouns, with case chosen by position
 *   - FINISH before a verb becomes past tense; WILL becomes future
 *   - NOT after a verb becomes "do not" / "does not" in the right place
 *   - a leading time sign moves to where English puts it (usually the end)
 *   - articles and copulas are reinserted around bare nouns
 *
 * Everything it produces is shown with a visible "approximate translation"
 * label and a confidence, and the gloss stays visible alongside it. If a
 * language model is wired in later it should replace this function wholesale,
 * not wrap it.
 */

export interface EnglishResult {
  text: string;
  /** Lowest confidence of any gloss that contributed. */
  confidence: number;
  /** True when the rules could not do better than concatenating the glosses. */
  literal: boolean;
}

const PRONOUN_SUBJECT: Record<string, string> = {
  'IX-me': 'I',
  'IX-you': 'you',
  'IX-he': 'he',
  'IX-she': 'she',
  'IX-it': 'it',
  'IX-we': 'we',
  'IX-they': 'they',
  'IX-he-she': 'they',
};

const PRONOUN_OBJECT: Record<string, string> = {
  'IX-me': 'me',
  'IX-you': 'you',
  'IX-he': 'him',
  'IX-she': 'her',
  'IX-it': 'it',
  'IX-we': 'us',
  'IX-they': 'them',
  'IX-he-she': 'them',
};

const POSSESSIVE: Record<string, string> = {
  'POSS-my': 'my',
  'POSS-your': 'your',
  'POSS-his': 'his',
  'POSS-her': 'her',
  'POSS-our': 'our',
  'POSS-their': 'their',
};

const TIME_SIGNS = new Set([
  'YESTERDAY', 'TODAY', 'TOMORROW', 'NOW', 'LATER', 'MORNING', 'NIGHT',
  'WEEK', 'MONTH', 'YEAR', 'SOON', 'BEFORE', 'AGAIN', 'ALWAYS', 'NEVER',
]);

const WH_SIGNS = new Set(['WHAT', 'WHO', 'WHERE', 'WHEN', 'WHY', 'HOW', 'WHICH', 'HOW-MANY']);

const VERBS = new Set([
  'GO', 'COME', 'WANT', 'NEED', 'HAVE', 'KNOW', 'UNDERSTAND', 'THINK', 'FEEL',
  'LIKE', 'LOVE', 'HELP', 'WORK', 'LEARN', 'TEACH', 'SEE', 'LOOK', 'SAY',
  'TELL', 'ASK', 'ANSWER', 'WAIT', 'EAT', 'DRINK', 'SLEEP', 'DRIVE', 'WALK',
  'BUY', 'PAY', 'READ', 'WRITE', 'MEET', 'START', 'STOP', 'REPEAT',
]);

const PAST_FORM: Record<string, string> = {
  GO: 'went', COME: 'came', SEE: 'saw', EAT: 'ate', DRINK: 'drank',
  SLEEP: 'slept', DRIVE: 'drove', BUY: 'bought', PAY: 'paid', READ: 'read',
  WRITE: 'wrote', MEET: 'met', TELL: 'told', SAY: 'said', KNOW: 'knew',
  THINK: 'thought', FEEL: 'felt', HAVE: 'had', TEACH: 'taught',
};

function pastOf(verb: string): string {
  const lower = verb.toLowerCase();
  if (PAST_FORM[verb]) return PAST_FORM[verb];
  if (lower.endsWith('e')) return `${lower}d`;
  return `${lower}ed`;
}

export interface GlossInput {
  gloss: string;
  confidence: number;
}

export function glossToEnglish(glosses: readonly GlossInput[]): EnglishResult {
  const tokens = glosses.filter((g) => !g.gloss.startsWith('('));
  if (tokens.length === 0) return { text: '', confidence: 0, literal: true };

  const confidence = Math.min(...tokens.map((t) => t.confidence));
  const words = tokens.map((t) => t.gloss);

  let past = false;
  let future = false;
  let negated = false;
  const time: string[] = [];
  const wh: string[] = [];
  const core: string[] = [];

  for (const gloss of words) {
    if (gloss === 'FINISH') {
      past = true;
      continue;
    }
    if (gloss === 'WILL') {
      future = true;
      continue;
    }
    if (gloss === 'NOT' || gloss === 'UNDERSTAND-NOT') {
      negated = true;
      if (gloss === 'UNDERSTAND-NOT') core.push('UNDERSTAND');
      continue;
    }
    if (TIME_SIGNS.has(gloss)) {
      time.push(gloss.toLowerCase().replace(/-/g, ' '));
      continue;
    }
    if (WH_SIGNS.has(gloss)) {
      wh.push(gloss.toLowerCase().replace(/-/g, ' '));
      continue;
    }
    core.push(gloss);
  }

  const out: string[] = [];
  let subjectTaken = false;

  core.forEach((gloss, i) => {
    if (gloss.startsWith('FS(')) {
      out.push(gloss.slice(3, -1).toLowerCase());
      return;
    }
    if (POSSESSIVE[gloss]) {
      out.push(POSSESSIVE[gloss]);
      return;
    }
    if (PRONOUN_SUBJECT[gloss]) {
      const word = !subjectTaken ? PRONOUN_SUBJECT[gloss] : PRONOUN_OBJECT[gloss];
      subjectTaken = true;
      out.push(word);
      return;
    }

    const isVerb = VERBS.has(gloss);
    if (isVerb) {
      if (negated) {
        out.push(past ? 'did not' : 'do not', gloss.toLowerCase().replace(/-/g, ' '));
        negated = false;
      } else if (future) {
        out.push('will', gloss.toLowerCase().replace(/-/g, ' '));
        future = false;
      } else if (past) {
        out.push(pastOf(gloss));
        past = false;
      } else {
        out.push(gloss.toLowerCase().replace(/-/g, ' '));
      }
      return;
    }

    // Bare noun: give it an article when nothing already determines it.
    const word = gloss.toLowerCase().replace(/-/g, ' ');
    const previous = out[out.length - 1];
    const determined = previous && (Object.values(POSSESSIVE).includes(previous) || previous === 'the' || previous === 'a');
    const isFirstAndSubject = i === 0 && !subjectTaken;
    out.push(determined || isFirstAndSubject ? word : `the ${word}`);
  });

  // Anything left over: negation with no verb, tense with no verb.
  if (negated) out.push('not');

  const timePhrase = time.join(' ');
  const whPhrase = wh.join(' ');

  let sentence = out.join(' ').replace(/\s+/g, ' ').trim();
  if (whPhrase) {
    sentence = sentence ? `${capitalise(whPhrase)} ${sentence}?` : `${capitalise(whPhrase)}?`;
  } else if (timePhrase) {
    sentence = `${capitalise(sentence)} ${timePhrase}.`;
  } else {
    sentence = `${capitalise(sentence)}.`;
  }

  const literal = out.length === core.length && !past && !future && !negated;
  return { text: sentence.replace(/\s+([.?])/g, '$1'), confidence, literal };
}

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
