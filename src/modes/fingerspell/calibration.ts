/**
 * On-device personalization for fingerspelling.
 *
 * The user records a handful of samples per letter; we fit a classifier to them
 * in the browser, in milliseconds, and store it in IndexedDB. This is the single
 * highest-leverage quality feature in Phase 1 - a generic model has to cover
 * every hand shape, sleeve, and camera angle in the world, while this one only
 * has to cover yours.
 *
 * Two heads are fitted from the same samples:
 *   - nearest-centroid prototypes, usable from 1 sample per class
 *   - a softmax (multinomial logistic) head, better once there are ~5+ per class
 *
 * Training on 63-float vectors rather than images is what makes this tractable:
 * a full fit over 26 x 10 samples is a few hundred thousand multiply-adds.
 */
import { meanVector } from '@/features/normalize';
import { STATIC_LETTERS } from './letterTemplates';
import type { OnnxLetterModel } from './classifier';

export const CALIBRATION_VERSION = 1;
export const FEATURE_DIM = 63;
/** Samples per letter the calibration flow asks for. */
export const TARGET_SAMPLES_PER_LETTER = 8;

export interface CalibrationSample {
  label: string;
  features: Float32Array;
  /** Capture time, so a user can re-calibrate and we can age out old samples. */
  t: number;
}

export interface PrototypeClass {
  label: string;
  centroid: Float32Array;
  sampleCount: number;
  /** Mean squared distance of the class's own samples to its centroid. */
  spread: number;
}

export interface LetterPrototypes {
  version: number;
  classes: PrototypeClass[];
  updatedAt: number;
}

export interface LinearHead {
  version: number;
  labels: string[];
  /** labels.length x FEATURE_DIM, row-major. */
  weights: Float32Array;
  bias: Float32Array;
  /** Training-set accuracy. Reported honestly in the UI; it is not held-out. */
  trainAccuracy: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Sample collection
// ---------------------------------------------------------------------------

export class CalibrationRecorder {
  private samples: CalibrationSample[] = [];

  constructor(initial: CalibrationSample[] = []) {
    this.samples = [...initial];
  }

  add(label: string, features: Float32Array): void {
    this.samples.push({ label, features: Float32Array.from(features), t: Date.now() });
  }

  removeLast(label: string): void {
    for (let i = this.samples.length - 1; i >= 0; i--) {
      if (this.samples[i].label === label) {
        this.samples.splice(i, 1);
        return;
      }
    }
  }

  clear(label?: string): void {
    this.samples = label ? this.samples.filter((s) => s.label !== label) : [];
  }

  countFor(label: string): number {
    return this.samples.filter((s) => s.label === label).length;
  }

  get all(): readonly CalibrationSample[] {
    return this.samples;
  }

  /** Letters still short of the target sample count, in alphabetical order. */
  get remaining(): string[] {
    return STATIC_LETTERS.filter((l) => this.countFor(l) < TARGET_SAMPLES_PER_LETTER);
  }

  get progress(): number {
    const target = STATIC_LETTERS.length * TARGET_SAMPLES_PER_LETTER;
    const have = STATIC_LETTERS.reduce(
      (a, l) => a + Math.min(this.countFor(l), TARGET_SAMPLES_PER_LETTER),
      0,
    );
    return target === 0 ? 0 : have / target;
  }
}

// ---------------------------------------------------------------------------
// Fitting
// ---------------------------------------------------------------------------

export function buildPrototypes(samples: readonly CalibrationSample[]): LetterPrototypes {
  const byLabel = new Map<string, Float32Array[]>();
  for (const s of samples) {
    const list = byLabel.get(s.label) ?? [];
    list.push(s.features);
    byLabel.set(s.label, list);
  }

  const classes: PrototypeClass[] = [];
  for (const [label, vectors] of byLabel) {
    const centroid = meanVector(vectors);
    if (!centroid) continue;
    let spread = 0;
    for (const v of vectors) {
      let d = 0;
      for (let i = 0; i < centroid.length; i++) {
        const diff = v[i] - centroid[i];
        d += diff * diff;
      }
      spread += d;
    }
    classes.push({
      label,
      centroid,
      sampleCount: vectors.length,
      spread: vectors.length ? spread / vectors.length : 0,
    });
  }

  classes.sort((a, b) => a.label.localeCompare(b.label));
  return { version: CALIBRATION_VERSION, classes, updatedAt: Date.now() };
}

export interface TrainOptions {
  epochs?: number;
  learningRate?: number;
  /** L2 penalty. Small sample counts overfit hard without it. */
  l2?: number;
  onProgress?: (epoch: number, total: number, loss: number) => void;
}

/**
 * Multinomial logistic regression by full-batch gradient descent.
 *
 * Deliberately plain: no optimizer state, no minibatching. With <=300 samples of
 * 63 dimensions this converges in well under a second on a phone, and plain code
 * is easier to trust than a clever one.
 */
export function trainLinearHead(
  samples: readonly CalibrationSample[],
  opts: TrainOptions = {},
): LinearHead | null {
  const { epochs = 300, learningRate = 0.5, l2 = 1e-3, onProgress } = opts;

  const labels = [...new Set(samples.map((s) => s.label))].sort();
  if (labels.length < 2) return null;
  const labelIndex = new Map(labels.map((l, i) => [l, i]));

  const K = labels.length;
  const D = FEATURE_DIM;
  const N = samples.length;
  const weights = new Float32Array(K * D);
  const bias = new Float32Array(K);
  const gradW = new Float32Array(K * D);
  const gradB = new Float32Array(K);
  const logits = new Float32Array(K);

  for (let epoch = 0; epoch < epochs; epoch++) {
    gradW.fill(0);
    gradB.fill(0);
    let loss = 0;

    for (const s of samples) {
      const y = labelIndex.get(s.label)!;
      let max = -Infinity;
      for (let k = 0; k < K; k++) {
        let z = bias[k];
        const off = k * D;
        for (let d = 0; d < D; d++) z += weights[off + d] * s.features[d];
        logits[k] = z;
        if (z > max) max = z;
      }
      let sum = 0;
      for (let k = 0; k < K; k++) {
        logits[k] = Math.exp(logits[k] - max);
        sum += logits[k];
      }
      for (let k = 0; k < K; k++) logits[k] /= sum;
      loss -= Math.log(Math.max(logits[y], 1e-9));

      for (let k = 0; k < K; k++) {
        const err = logits[k] - (k === y ? 1 : 0);
        gradB[k] += err;
        const off = k * D;
        for (let d = 0; d < D; d++) gradW[off + d] += err * s.features[d];
      }
    }

    const scale = learningRate / N;
    for (let i = 0; i < weights.length; i++) {
      weights[i] -= scale * gradW[i] + learningRate * l2 * weights[i];
    }
    for (let k = 0; k < K; k++) bias[k] -= scale * gradB[k];

    if (onProgress && epoch % 25 === 0) onProgress(epoch, epochs, loss / N);
  }

  const head: LinearHead = {
    version: CALIBRATION_VERSION,
    labels,
    weights,
    bias,
    trainAccuracy: 0,
    updatedAt: Date.now(),
  };
  head.trainAccuracy = scoreHead(head, samples);
  return head;
}

export function runLinearHead(head: LinearHead, features: Float32Array): Float32Array {
  const K = head.labels.length;
  const D = FEATURE_DIM;
  const out = new Float32Array(K);
  let max = -Infinity;
  for (let k = 0; k < K; k++) {
    let z = head.bias[k];
    const off = k * D;
    for (let d = 0; d < D; d++) z += head.weights[off + d] * features[d];
    out[k] = z;
    if (z > max) max = z;
  }
  let sum = 0;
  for (let k = 0; k < K; k++) {
    out[k] = Math.exp(out[k] - max);
    sum += out[k];
  }
  for (let k = 0; k < K; k++) out[k] /= sum || 1;
  return out;
}

export function scoreHead(head: LinearHead, samples: readonly CalibrationSample[]): number {
  if (samples.length === 0) return 0;
  let correct = 0;
  for (const s of samples) {
    const probs = runLinearHead(head, s.features);
    let best = 0;
    for (let k = 1; k < probs.length; k++) if (probs[k] > probs[best]) best = k;
    if (head.labels[best] === s.label) correct++;
  }
  return correct / samples.length;
}

/**
 * Leave-one-out accuracy over the calibration set.
 *
 * Reported instead of training accuracy wherever the number is shown to the
 * user, because training accuracy on 8 samples per class is meaningless and
 * would flatter the model. Still not a held-out *signer* - see docs/MODELS.md.
 */
export function leaveOneOutAccuracy(samples: readonly CalibrationSample[]): number {
  if (samples.length < 4) return 0;
  const protoAll = buildPrototypes(samples);
  if (protoAll.classes.length < 2) return 0;

  let correct = 0;
  for (let i = 0; i < samples.length; i++) {
    const rest = samples.filter((_, j) => j !== i);
    const proto = buildPrototypes(rest);
    if (proto.classes.length < 2) continue;
    let best = '';
    let bestD = Infinity;
    for (const c of proto.classes) {
      let d = 0;
      for (let k = 0; k < c.centroid.length; k++) {
        const diff = samples[i].features[k] - c.centroid[k];
        d += diff * diff;
      }
      if (d < bestD) {
        bestD = d;
        best = c.label;
      }
    }
    if (best === samples[i].label) correct++;
  }
  return correct / samples.length;
}

/** Per-letter leave-one-out accuracy, for the honest debug panel. */
export function perLetterAccuracy(samples: readonly CalibrationSample[]): Record<string, number> {
  const out: Record<string, number> = {};
  const byLabel = new Map<string, CalibrationSample[]>();
  for (const s of samples) {
    const list = byLabel.get(s.label) ?? [];
    list.push(s);
    byLabel.set(s.label, list);
  }
  for (const [label, group] of byLabel) {
    let correct = 0;
    for (const sample of group) {
      const proto = buildPrototypes(samples.filter((s) => s !== sample));
      let best = '';
      let bestD = Infinity;
      for (const c of proto.classes) {
        let d = 0;
        for (let k = 0; k < c.centroid.length; k++) {
          const diff = sample.features[k] - c.centroid[k];
          d += diff * diff;
        }
        if (d < bestD) {
          bestD = d;
          best = c.label;
        }
      }
      if (best === label) correct++;
    }
    out[label] = group.length ? correct / group.length : 0;
  }
  return out;
}

/** Adapts a locally-trained head to the model interface the classifier consumes. */
export function asLetterModel(head: LinearHead): OnnxLetterModel {
  return {
    labels: head.labels,
    async run(features: Float32Array) {
      return runLinearHead(head, features);
    },
  };
}
