/**
 * Clip dictionary for Reverse mode.
 *
 * The output path that ships first, because it is the honest one: real hands
 * performing real signs. Its limits are real too - stitched clips cannot do
 * spatial grammar, cannot inflect a verb through space, and the crossfades
 * between them are not the transitions a signer would actually make.
 *
 * /public/clips/manifest.json ships EMPTY. Sign video is somebody's work and
 * usually somebody's likeness; populating it means recording your own or
 * licensing a set, and recording your own with Deaf signers is the better
 * answer. Every gloss without a clip is fingerspelled instead, which is what a
 * hearing signer would do anyway when they do not know a sign.
 */

export interface ClipEntry {
  gloss: string;
  file: string;
  durationMs: number;
  /** Who performed and licensed this clip. Required; shown in the credits. */
  credit: string;
  license: string;
}

export interface ClipManifest {
  version: number;
  /** Where this set came from, shown in Settings > About. */
  source: string;
  license: string;
  credits: string[];
  entries: ClipEntry[];
}

export const EMPTY_MANIFEST: ClipManifest = {
  version: 1,
  source: 'none',
  license: 'n/a',
  credits: [],
  entries: [],
};

let cache: Promise<ClipManifest> | null = null;

export function loadClipManifest(): Promise<ClipManifest> {
  if (!cache) {
    cache = fetch('/clips/manifest.json')
      .then((r) => (r.ok ? (r.json() as Promise<ClipManifest>) : EMPTY_MANIFEST))
      .catch(() => EMPTY_MANIFEST);
  }
  return cache;
}

export class ClipDictionary {
  private byGloss = new Map<string, ClipEntry>();

  constructor(private manifest: ClipManifest = EMPTY_MANIFEST) {
    for (const entry of manifest.entries) this.byGloss.set(entry.gloss.toUpperCase(), entry);
  }

  static async load(): Promise<ClipDictionary> {
    return new ClipDictionary(await loadClipManifest());
  }

  get size(): number {
    return this.byGloss.size;
  }

  get credits(): string[] {
    return this.manifest.credits;
  }

  get source(): string {
    return this.manifest.source;
  }

  has(gloss: string): boolean {
    return this.byGloss.has(gloss.toUpperCase());
  }

  get(gloss: string): ClipEntry | undefined {
    return this.byGloss.get(gloss.toUpperCase());
  }

  /** The set the gloss engine consults to decide what to fingerspell. */
  availableGlosses(): ReadonlySet<string> {
    return new Set(this.byGloss.keys());
  }
}

export type PlaybackStep =
  | { kind: 'clip'; entry: ClipEntry; gloss: string }
  | { kind: 'fingerspell'; letters: string[]; gloss: string }
  | { kind: 'nmm'; description: string; gloss: string };

/** Turn gloss tokens into a playable sequence, spelling whatever has no clip. */
export function buildPlayback(
  tokens: readonly { gloss: string; kind: string }[],
  dictionary: ClipDictionary,
): PlaybackStep[] {
  const steps: PlaybackStep[] = [];
  for (const token of tokens) {
    if (token.kind === 'nmm') {
      steps.push({ kind: 'nmm', description: token.gloss, gloss: token.gloss });
      continue;
    }
    const bare = token.gloss.startsWith('FS(') ? token.gloss.slice(3, -1) : token.gloss;
    const entry = dictionary.get(bare);
    if (entry) {
      steps.push({ kind: 'clip', entry, gloss: bare });
    } else {
      steps.push({
        kind: 'fingerspell',
        letters: [...bare.replace(/[^A-Za-z0-9]/g, '').toUpperCase()],
        gloss: bare,
      });
    }
  }
  return steps;
}
