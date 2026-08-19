/**
 * Transcript export.
 *
 * Plain text for reading, SRT for anyone captioning a recording of the session.
 * Both carry the disclaimer in the file itself, because a transcript that leaves
 * this app loses every piece of surrounding context that says what produced it.
 */
import type { Token } from '@/store';

const HEADER = [
  'Produced by SignBridge, an automated sign-recognition assistant.',
  'This is not an interpretation and was not produced by a qualified interpreter.',
  'It contains recognition errors. Words marked [?] were below the confidence threshold.',
].join('\n');

export function toPlainText(tokens: readonly Token[], startedAt: number, threshold = 0.65): string {
  const body = tokens
    .map((t) => (t.confidence < threshold && !t.corrected ? `${t.text}[?]` : t.text))
    .join(' ');
  return `${HEADER}\nSession started ${new Date(startedAt).toLocaleString()}\n\n${body}\n`;
}

/**
 * SRT with one cue per word.
 *
 * Word-level timing is what the recogniser actually knows; grouping into
 * sentences would require inventing sentence boundaries that fingerspelled
 * input does not have.
 */
export function toSrt(
  tokens: readonly { text: string; confidence: number; at?: number }[],
  startedAt: number,
  msPerToken = 1200,
): string {
  return tokens
    .map((token, i) => {
      const start = token.at !== undefined ? token.at - startedAt : i * msPerToken;
      const end = start + msPerToken;
      return `${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${token.text}\n`;
    })
    .join('\n');
}

function srtTime(ms: number): string {
  const clamped = Math.max(0, ms);
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = Math.floor(clamped % 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}
