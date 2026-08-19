/**
 * Phase 2 target vocabulary - 150 signs.
 *
 * Chosen for conversational coverage rather than dictionary size. The reasoning
 * from the build plan holds: 150 signs at 85% is a product, 2000 signs at 45%
 * is a demo that wastes people's time. These are the signs that let someone
 * order food, ask for help, exchange names, and end a conversation politely.
 *
 * This is a TARGET list, not a claim of support. Nothing here is recognised
 * until a model trained on it ships (see docs/MODELS.md). The UI reads
 * `SIGN_VOCABULARY` only to show what Phase 2 is aiming at, and to seed the
 * custom-sign recorder with sensible suggestions.
 *
 * It should be reviewed by a Deaf consultant before any training run - regional
 * variation means some of these have more than one correct form.
 */

export interface VocabularyEntry {
  gloss: string;
  category: string;
  /** Two-handed signs need both hands tracked; single-handed ones do not. */
  twoHanded: boolean;
}

const E = (gloss: string, category: string, twoHanded = false): VocabularyEntry => ({
  gloss,
  category,
  twoHanded,
});

export const SIGN_VOCABULARY: readonly VocabularyEntry[] = [
  // Greetings and social (14)
  E('HELLO', 'social'), E('GOODBYE', 'social'), E('THANK-YOU', 'social'),
  E('PLEASE', 'social'), E('SORRY', 'social'), E('EXCUSE-ME', 'social'),
  E('NICE-TO-MEET-YOU', 'social', true), E('HOW-ARE-YOU', 'social'),
  E('FINE', 'social'), E('GOOD', 'social'), E('BAD', 'social'),
  E('YES', 'social'), E('NO', 'social'), E('MAYBE', 'social', true),

  // Pronouns and reference (10)
  E('IX-me', 'pronoun'), E('IX-you', 'pronoun'), E('IX-he-she', 'pronoun'),
  E('IX-we', 'pronoun'), E('IX-they', 'pronoun'), E('POSS-my', 'pronoun'),
  E('POSS-your', 'pronoun'), E('SELF', 'pronoun'), E('SAME', 'pronoun', true),
  E('OTHER', 'pronoun'),

  // Questions (8)
  E('WHAT', 'question', true), E('WHO', 'question'), E('WHERE', 'question'),
  E('WHEN', 'question'), E('WHY', 'question'), E('HOW', 'question', true),
  E('WHICH', 'question', true), E('HOW-MANY', 'question'),

  // Core verbs (26)
  E('WANT', 'verb', true), E('NEED', 'verb'), E('HAVE', 'verb', true),
  E('GO', 'verb', true), E('COME', 'verb', true), E('KNOW', 'verb'),
  E('UNDERSTAND', 'verb'), E('THINK', 'verb'), E('FEEL', 'verb'),
  E('LIKE', 'verb'), E('LOVE', 'verb', true), E('HELP', 'verb', true),
  E('WORK', 'verb', true), E('LEARN', 'verb', true), E('TEACH', 'verb', true),
  E('SEE', 'verb'), E('LOOK', 'verb'), E('SAY', 'verb'),
  E('TELL', 'verb'), E('ASK', 'verb'), E('ANSWER', 'verb', true),
  E('WAIT', 'verb', true), E('FINISH', 'verb', true), E('START', 'verb', true),
  E('STOP', 'verb', true), E('REPEAT', 'verb', true),

  // Everyday verbs (12)
  E('EAT', 'verb'), E('DRINK', 'verb'), E('SLEEP', 'verb'),
  E('DRIVE', 'verb', true), E('WALK', 'verb', true), E('BUY', 'verb', true),
  E('PAY', 'verb', true), E('READ', 'verb', true), E('WRITE', 'verb', true),
  E('CALL-PHONE', 'verb'), E('TEXT', 'verb'), E('MEET', 'verb', true),

  // People (12)
  E('NAME', 'person', true), E('DEAF', 'person'), E('HEARING', 'person'),
  E('FRIEND', 'person', true), E('FAMILY', 'person', true), E('MOTHER', 'person'),
  E('FATHER', 'person'), E('CHILD', 'person'), E('MAN', 'person'),
  E('WOMAN', 'person'), E('TEACHER', 'person', true), E('DOCTOR', 'person'),

  // Places and things (16)
  E('HOME', 'place'), E('SCHOOL', 'place', true), E('WORK-PLACE', 'place', true),
  E('STORE', 'place', true), E('HOSPITAL', 'place'), E('BATHROOM', 'place'),
  E('CAR', 'thing', true), E('BUS', 'thing', true), E('PHONE', 'thing'),
  E('COMPUTER', 'thing', true), E('BOOK', 'thing', true), E('FOOD', 'thing'),
  E('WATER', 'thing'), E('COFFEE', 'thing', true), E('MONEY', 'thing', true),
  E('TICKET', 'thing', true),

  // Time (16)
  E('NOW', 'time', true), E('TODAY', 'time', true), E('TOMORROW', 'time'),
  E('YESTERDAY', 'time'), E('MORNING', 'time', true), E('NIGHT', 'time', true),
  E('WEEK', 'time', true), E('MONTH', 'time'), E('YEAR', 'time', true),
  E('TIME', 'time'), E('LATER', 'time'), E('BEFORE', 'time', true),
  E('AGAIN', 'time', true), E('ALWAYS', 'time'), E('NEVER', 'time'),
  E('SOON', 'time'),

  // Descriptions (16)
  E('BIG', 'describe', true), E('SMALL', 'describe', true),
  E('MORE', 'describe', true), E('MANY', 'describe', true), E('FEW', 'describe'),
  E('HOT', 'describe'), E('COLD', 'describe', true), E('HAPPY', 'describe', true),
  E('SAD', 'describe', true), E('TIRED', 'describe', true), E('SICK', 'describe', true),
  E('HUNGRY', 'describe'), E('BUSY', 'describe', true), E('EASY', 'describe', true),
  E('HARD', 'describe', true), E('IMPORTANT', 'describe', true),

  // Conversation management (12)
  E('SLOW-DOWN', 'meta', true), E('AGAIN-PLEASE', 'meta', true), E('FINGERSPELL', 'meta'),
  E('SIGN', 'meta', true), E('WRITE-DOWN', 'meta', true), E('INTERPRETER', 'meta', true),
  E('UNDERSTAND-NOT', 'meta'), E('CLEAR', 'meta', true), E('WRONG', 'meta'),
  E('RIGHT-CORRECT', 'meta', true), E('EXCUSE-INTERRUPT', 'meta', true), E('DONE', 'meta', true),
];

export const VOCABULARY_CATEGORIES = [
  ...new Set(SIGN_VOCABULARY.map((e) => e.category)),
];

export function vocabularyGlosses(): string[] {
  return SIGN_VOCABULARY.map((e) => e.gloss);
}
