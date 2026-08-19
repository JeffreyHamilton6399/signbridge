/**
 * Completion dictionary for fingerspelling.
 *
 * Roughly the 600 most frequent English words plus the letters' worth of short
 * function words that dominate fingerspelled text, ordered by descending
 * frequency. It is deliberately small: it ships in the bundle, works offline,
 * and a bigger list mostly adds noise to a three-slot suggestion strip.
 *
 * The user's own committed words are merged on top of this at runtime and
 * persisted locally (see autocomplete.ts), which is what actually makes the
 * suggestions feel personal - names, places and jargon come from there.
 */
export const COMMON_WORDS: readonly string[] = [
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
  'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
  'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take',
  'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other',
  'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
  'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way',
  'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us',
  'name', 'here', 'help', 'please', 'thanks', 'thank', 'sorry', 'yes', 'okay', 'hello',
  'hi', 'bye', 'goodbye', 'again', 'more', 'need', 'find', 'tell', 'ask', 'try',
  'call', 'feel', 'become', 'leave', 'put', 'mean', 'keep', 'let', 'begin', 'seem',
  'talk', 'turn', 'start', 'show', 'hear', 'play', 'run', 'move', 'live', 'believe',
  'hold', 'bring', 'happen', 'write', 'sit', 'stand', 'lose', 'pay', 'meet', 'include',
  'continue', 'set', 'learn', 'change', 'lead', 'watch', 'follow', 'stop', 'create', 'speak',
  'read', 'spend', 'grow', 'open', 'walk', 'win', 'teach', 'offer', 'remember', 'consider',
  'appear', 'buy', 'wait', 'serve', 'die', 'send', 'build', 'stay', 'fall', 'cut',
  'reach', 'kill', 'raise', 'pass', 'sell', 'decide', 'return', 'explain', 'hope', 'develop',
  'carry', 'break', 'receive', 'agree', 'support', 'hit', 'produce', 'eat', 'cover', 'catch',
  'draw', 'choose', 'man', 'woman', 'child', 'world', 'school', 'state', 'family', 'student',
  'group', 'country', 'problem', 'hand', 'part', 'place', 'case', 'week', 'company', 'system',
  'program', 'question', 'number', 'night', 'point', 'home', 'water', 'room', 'mother', 'father',
  'area', 'money', 'story', 'fact', 'month', 'lot', 'right', 'study', 'book', 'eye',
  'job', 'word', 'business', 'issue', 'side', 'kind', 'head', 'house', 'service', 'friend',
  'power', 'hour', 'game', 'line', 'end', 'member', 'law', 'car', 'city', 'community',
  'health', 'person', 'team', 'minute', 'idea', 'kid', 'body', 'information', 'parent', 'face',
  'level', 'office', 'door', 'health', 'art', 'war', 'history', 'party', 'result', 'morning',
  'reason', 'research', 'girl', 'guy', 'moment', 'air', 'teacher', 'force', 'education', 'foot',
  'boy', 'age', 'policy', 'process', 'music', 'market', 'sense', 'nation', 'plan', 'college',
  'interest', 'death', 'experience', 'effect', 'class', 'control', 'care', 'field', 'development', 'role',
  'effort', 'rule', 'practice', 'town', 'road', 'drive', 'arm', 'true', 'federal', 'break',
  'better', 'difference', 'thought', 'cost', 'street', 'couple', 'natural', 'food', 'north', 'south',
  'east', 'west', 'today', 'tomorrow', 'yesterday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december', 'deaf', 'hearing', 'sign', 'language', 'interpreter', 'asl',
  'coffee', 'water', 'phone', 'email', 'address', 'number', 'appointment', 'doctor', 'hospital', 'store',
  'restaurant', 'bathroom', 'ticket', 'train', 'bus', 'airport', 'hotel', 'street', 'building', 'apartment',
  'computer', 'internet', 'password', 'account', 'meeting', 'project', 'deadline', 'manager', 'client', 'contract',
  'great', 'small', 'large', 'young', 'old', 'high', 'low', 'long', 'short', 'early',
  'late', 'hard', 'easy', 'important', 'different', 'same', 'able', 'sure', 'clear', 'real',
  'best', 'happy', 'sad', 'angry', 'tired', 'hungry', 'cold', 'hot', 'sick', 'fine',
  'nice', 'bad', 'wrong', 'ready', 'busy', 'free', 'safe', 'careful', 'quiet', 'loud',
  'again', 'always', 'never', 'sometimes', 'often', 'usually', 'maybe', 'really', 'very', 'too',
  'much', 'many', 'few', 'little', 'enough', 'almost', 'together', 'alone', 'before', 'during',
  'while', 'until', 'since', 'without', 'through', 'between', 'against', 'under', 'above', 'behind',
];

/**
 * Letters the recogniser genuinely confuses, used to widen prefix search.
 * Keep this in sync with CONFUSION_CLUSTERS in letterTemplates.ts.
 */
export const LETTER_CONFUSIONS: Record<string, readonly string[]> = {
  m: ['n', 's', 't', 'e'],
  n: ['m', 't', 's'],
  s: ['a', 't', 'm', 'e'],
  t: ['s', 'n', 'a'],
  e: ['s', 'm', 'o'],
  a: ['s', 't'],
  r: ['u', 'v'],
  u: ['r', 'v'],
  v: ['u', 'r'],
  k: ['v', 'p'],
  p: ['k', 'q'],
  q: ['g', 'p'],
  g: ['q', 'h'],
  h: ['u', 'g'],
  d: ['f', 'x'],
  o: ['c', 'e'],
  c: ['o'],
};
