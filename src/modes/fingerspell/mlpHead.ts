/**
 * The personal model: a small MLP fitted in the browser from the user's own
 * calibration samples.
 *
 * WHY NOT THE LINEAR HEAD
 * -----------------------
 * The head this replaces is multinomial logistic regression — one weight per
 * coordinate per letter, summed. That structure can express "the thumb is far
 * across the knuckles" and it can express "the fingers are draped", but it
 * cannot express *the conjunction*: a linear model's answer to two features is
 * always the sum of its answers to each one alone.
 *
 * The fist cluster is exactly a conjunction. A thumb reading low-across means A
 * when the fingers are flat and means "the tracker is guessing, ignore it" when
 * the fingers are draped. Those are opposite conclusions from the same
 * coordinate, decided by a different one, and no setting of a linear weight
 * produces both. One hidden layer does, because a hidden unit can fire on a
 * combination and the output layer can then weigh the combination.
 *
 * That is the whole argument for the change. It is not "bigger is better" — the
 * net is 4,000 parameters and would be a rounding error in a real model. It is
 * that the previous one was the wrong shape for the problem the user is
 * actually hitting.
 *
 * WHY IT DOES NOT OVERFIT ON EIGHT SAMPLES
 * ----------------------------------------
 * It would, trained naively: 4,000 parameters over 192 points memorises. Three
 * things prevent it, in order of importance.
 *
 *   1. **Fresh augmentation every epoch.** Each sample is re-tilted and
 *      re-noised on every pass (see features/augment.ts), so the net never sees
 *      the same vector twice and cannot memorise coordinates. This is both
 *      stronger regularization than a fixed augmented set and cheaper — the set
 *      is never materialised.
 *   2. **A narrow hidden layer.** 48 units is a real bottleneck at 63 inputs.
 *   3. **Weight decay**, applied to weights and not to biases.
 *
 * WHAT IT REPORTS, AND WHY THE NUMBER IS STILL NOT A PREDICTION
 * -------------------------------------------------------------
 * `trainAccuracy` on an over-parameterized net is meaningless and sits near
 * 100% whatever happened, so a held-out number is measured too: a quarter of
 * the real samples are set aside, the net is fitted on the rest, and scored on
 * the withheld quarter. The shipped weights are then refitted on everything.
 *
 * That number was then checked against the thing it looks like it predicts —
 * accuracy in a *later session*, at a different hand angle — on synthetic data,
 * six trials. It does not predict it:
 *
 *     scored plain                true 89% / 96%   reported 98% / 100%
 *     scored at training tilt     true 89% / 96%   reported 96% /  95%
 *     scored at 2x training tilt  true 89% / 96%   reported 92% /  89%
 *
 * No setting tracks both cases. Scoring at the training tilt is nearly exact on
 * the fist cluster and seven points optimistic across all letters; doubling the
 * tilt reverses which one it flatters. The reason is structural: **you cannot
 * measure robustness to a transformation you trained on.** The model is
 * tilt-invariant because augmentation taught it to be, so re-tilting the
 * withheld samples asks a question it has already been drilled on.
 *
 * So the shipped measure scores at the training envelope — the least-bad of the
 * three, never wildly optimistic — and everything that displays it says it is
 * an upper bound rather than an estimate. What it is genuinely good for is
 * *relative* comparison: whether adding more samples of a letter helped.
 *
 * It is a held-out sample, not a held-out session and emphatically not a
 * held-out signer. It is not a substitute for the evaluation any shipped model
 * needs, and no number from here belongs in a model card.
 */
import { augment, rng } from '@/features/augment';
import type { AugmentOptions } from '@/features/augment';
import { CALIBRATION_VERSION, FEATURE_DIM, runLinearHead } from './calibration';
import type { CalibrationSample, LinearHead } from './calibration';

/** Hidden units. Narrow on purpose — the bottleneck is doing regularization work. */
export const HIDDEN_UNITS = 48;

export interface MlpHead {
  kind: 'mlp';
  version: number;
  labels: string[];
  hidden: number;
  /** hidden x FEATURE_DIM, row-major. */
  w1: Float32Array;
  b1: Float32Array;
  /** labels.length x hidden, row-major. */
  w2: Float32Array;
  b2: Float32Array;
  /** Accuracy on the samples it was fitted on. Near-meaningless; shown for contrast. */
  trainAccuracy: number;
  /**
   * Accuracy on real samples withheld from fitting, or null when there were too
   * few samples to withhold any. The honest number, with the caveat above.
   */
  holdoutAccuracy: number | null;
  updatedAt: number;
}

/** Either kind of locally-fitted head. Distinguished by `kind`. */
export type FittedHead = LinearHead | MlpHead;

export function isMlpHead(head: FittedHead): head is MlpHead {
  return (head as MlpHead).kind === 'mlp';
}

/** Probabilities from whichever head this is. */
export function runFittedHead(head: FittedHead, features: Float32Array): Float32Array {
  return isMlpHead(head) ? runMlpHead(head, features) : runLinearHead(head, features);
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

export function runMlpHead(head: MlpHead, features: Float32Array): Float32Array {
  const { w1, b1, w2, b2, hidden } = head;
  const K = head.labels.length;
  const D = FEATURE_DIM;

  const h = new Float32Array(hidden);
  for (let j = 0; j < hidden; j++) {
    let z = b1[j];
    const off = j * D;
    for (let d = 0; d < D; d++) z += w1[off + d] * features[d];
    h[j] = z > 0 ? z : 0;
  }

  const out = new Float32Array(K);
  let max = -Infinity;
  for (let k = 0; k < K; k++) {
    let z = b2[k];
    const off = k * hidden;
    for (let j = 0; j < hidden; j++) z += w2[off + j] * h[j];
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

export function scoreMlpHead(head: MlpHead, samples: readonly CalibrationSample[]): number {
  if (samples.length === 0) return 0;
  let correct = 0;
  for (const s of samples) {
    const probs = runMlpHead(head, s.features);
    let best = 0;
    for (let k = 1; k < probs.length; k++) if (probs[k] > probs[best]) best = k;
    if (head.labels[best] === s.label) correct++;
  }
  return correct / samples.length;
}

// ---------------------------------------------------------------------------
// Fitting
// ---------------------------------------------------------------------------

export interface MlpTrainOptions {
  epochs?: number;
  learningRate?: number;
  /** L2 penalty, applied to weights and not to biases. */
  weightDecay?: number;
  batchSize?: number;
  hidden?: number;
  /** Seed for augmentation and initialization, so a fit is reproducible. */
  seed?: number;
  augment?: AugmentOptions;
  /** Set false to fit on every sample and skip the held-out measurement. */
  measureHoldout?: boolean;
}

const DEFAULTS = {
  // Measured, not guessed: averaged over six train/test pairs on the fist
  // cluster, accuracy climbs 84% -> 92% -> 98% from 60 to 120 to 180 epochs and
  // is then flat to 360 within noise. 260 sits on the plateau with margin, at
  // about 190ms for six letters and 700ms for twenty-four.
  epochs: 260,
  learningRate: 0.012,
  weightDecay: 3e-4,
  batchSize: 32,
  hidden: HIDDEN_UNITS,
  seed: 1,
};

/** One Adam-updated parameter tensor. */
class Param {
  readonly value: Float32Array;
  private readonly grad: Float32Array;
  private readonly m: Float32Array;
  private readonly v: Float32Array;

  constructor(
    size: number,
    private readonly decay: number,
    init?: (i: number) => number,
  ) {
    this.value = new Float32Array(size);
    this.grad = new Float32Array(size);
    this.m = new Float32Array(size);
    this.v = new Float32Array(size);
    if (init) for (let i = 0; i < size; i++) this.value[i] = init(i);
  }

  accumulate(i: number, g: number): void {
    this.grad[i] += g;
  }

  /** Adam, with bias correction folded into the step size by the caller. */
  step(lrHat: number, scale: number): void {
    const { value, grad, m, v, decay } = this;
    for (let i = 0; i < value.length; i++) {
      const g = grad[i] * scale + decay * value[i];
      m[i] = 0.9 * m[i] + 0.1 * g;
      v[i] = 0.999 * v[i] + 0.001 * g * g;
      value[i] -= (lrHat * m[i]) / (Math.sqrt(v[i]) + 1e-8);
      grad[i] = 0;
    }
  }
}

/**
 * Fit the personal head for a set of samples. The one place that decides which
 * kind to fit — every caller should use this rather than picking for itself.
 *
 * It always picks the MLP, which sounds like no decision at all and is worth
 * recording as one. The expectation was a crossover: a linear head at low
 * sample counts where an MLP would overfit, the MLP once there was enough to
 * fit it on. Measured against a later session at a different hand angle, over
 * eight trials, there is no crossover — the MLP wins at every count tried,
 * including two samples per letter:
 *
 *     samples/letter    2      3      4      6      8     12
 *     prototypes       63%    65%    65%    67%    71%    76%
 *     linear head      55%    59%    57%    60%    66%    72%
 *     MLP              89%    80%    91%    97%    95%   100%   (fist cluster)
 *
 * Fresh-augmentation-per-epoch is why: two samples still produce hundreds of
 * distinct training vectors, so the regime where a linear model's rigidity
 * would be protective never arrives.
 *
 * Those are synthetic hands, so read them as comparative and not as accuracy
 * claims. The comparison is the part that transfers, and it is not close.
 *
 * {@link trainLinearHead} stays exported because stored heads from older builds
 * still load and run through {@link runFittedHead}. Nothing fits a new one.
 */
export function fitPersonalHead(
  samples: readonly CalibrationSample[],
  opts: MlpTrainOptions = {},
): FittedHead | null {
  return trainMlpHead(samples, opts);
}

/**
 * Fit an MLP head. Returns null when there is not enough to fit — fewer than
 * two labels, or a label with no samples.
 *
 * Synchronous and CPU-bound for a second or two. Callers run it off the frame
 * path; it must never be called from the per-frame loop.
 */
export function trainMlpHead(
  samples: readonly CalibrationSample[],
  opts: MlpTrainOptions = {},
): MlpHead | null {
  const cfg = { ...DEFAULTS, ...opts };
  const labels = [...new Set(samples.map((s) => s.label))].sort();
  if (labels.length < 2) return null;

  const measure = opts.measureHoldout !== false;
  let holdoutAccuracy: number | null = null;

  if (measure) {
    const { fit, held } = stratifiedHoldout(samples, labels);
    // Only meaningful if something was actually withheld from every class and
    // enough was left to fit on.
    if (held.length > 0 && fit.length >= labels.length * 2) {
      const probe = fitOnce(fit, labels, cfg, opts.augment);
      if (probe) holdoutAccuracy = scoreAcrossAngles(probe, held, opts.augment);
    }
  }

  const head = fitOnce(samples, labels, cfg, opts.augment);
  if (!head) return null;
  head.holdoutAccuracy = holdoutAccuracy;
  return head;
}

/** Angles each withheld sample is re-scored at. */
const HOLDOUT_ANGLES = 8;

/**
 * Score withheld samples at angles the model never saw.
 *
 * Scoring them as-is answers the wrong question. Every sample in a calibration
 * set comes from one sitting, at one hand angle, in one light — so a withheld
 * sample is a pose the model has not seen taken under conditions it has seen a
 * great deal of, and it gets classified almost perfectly. Measured that way the
 * number came out at 100% while true accuracy in a *later* session was 89–96%,
 * which is precisely the kind of flattering figure this project is not allowed
 * to print.
 *
 * Re-tilting each withheld sample first asks the question that matters: will
 * this still work tomorrow, when the hand is held a little differently? It is
 * the same transformation training uses, drawn from a separate stream so the
 * angles are not the ones fitted on.
 *
 * Still an upper bound, and the UI must keep saying so. Same signer, same
 * session, same sleeves, same light — a synthetic tilt is not a second sitting,
 * and none of this is a held-out *signer*, which is the only measurement that
 * would justify a number in a model card.
 */
function scoreAcrossAngles(
  head: MlpHead,
  held: readonly CalibrationSample[],
  augmentOpts: AugmentOptions | undefined,
): number {
  if (held.length === 0) return 0;
  // A stream unrelated to the training seed, so the evaluation angles are not
  // the ones the fit happened to be shown.
  const next = rng(0x5eed ^ held.length);
  let correct = 0;
  let total = 0;
  for (const s of held) {
    for (let i = 0; i < HOLDOUT_ANGLES; i++) {
      const probs = runMlpHead(head, augment(s.features, next, augmentOpts));
      let best = 0;
      for (let k = 1; k < probs.length; k++) if (probs[k] > probs[best]) best = k;
      if (head.labels[best] === s.label) correct++;
      total++;
    }
  }
  return correct / total;
}

/**
 * Every fourth sample of each label, withheld.
 *
 * Deterministic rather than random: two fits of the same calibration set should
 * report the same number, or the number is not telling the user anything about
 * their calibration.
 */
function stratifiedHoldout(
  samples: readonly CalibrationSample[],
  labels: string[],
): { fit: CalibrationSample[]; held: CalibrationSample[] } {
  const fit: CalibrationSample[] = [];
  const held: CalibrationSample[] = [];
  for (const label of labels) {
    const own = samples.filter((s) => s.label === label);
    // Below four samples there is nothing to spare: withholding one would take
    // a third of the evidence for that letter to measure a single point.
    if (own.length < 4) {
      fit.push(...own);
      continue;
    }
    own.forEach((s, i) => (i % 4 === 0 ? held : fit).push(s));
  }
  return { fit, held };
}

function fitOnce(
  samples: readonly CalibrationSample[],
  labels: string[],
  cfg: typeof DEFAULTS,
  augmentOpts: AugmentOptions | undefined,
): MlpHead | null {
  const D = FEATURE_DIM;
  const H = cfg.hidden;
  const K = labels.length;
  const N = samples.length;
  if (N === 0) return null;

  const labelIndex = new Map(labels.map((l, i) => [l, i]));
  const next = rng(cfg.seed);

  // He initialization: the right scale for ReLU, and getting it wrong is the
  // usual reason a small net trains slowly or not at all.
  const s1 = Math.sqrt(2 / D);
  const s2 = Math.sqrt(2 / H);
  const normal = () => {
    const u = Math.max(next(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  const w1 = new Param(H * D, cfg.weightDecay, () => normal() * s1);
  const b1 = new Param(H, 0);
  const w2 = new Param(K * H, cfg.weightDecay, () => normal() * s2);
  const b2 = new Param(K, 0);

  const hPre = new Float32Array(H);
  const h = new Float32Array(H);
  const logits = new Float32Array(K);
  const dh = new Float32Array(H);

  const order = samples.map((_, i) => i);
  let stepCount = 0;

  for (let epoch = 0; epoch < cfg.epochs; epoch++) {
    // Fisher-Yates with the seeded source, so epoch order is reproducible too.
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    for (let start = 0; start < N; start += cfg.batchSize) {
      const end = Math.min(start + cfg.batchSize, N);
      const batch = end - start;

      for (let bi = start; bi < end; bi++) {
        const sample = samples[order[bi]];
        const y = labelIndex.get(sample.label)!;
        // Fresh every epoch: the net never sees this exact vector again.
        const x = augment(sample.features, next, augmentOpts);

        for (let j = 0; j < H; j++) {
          let z = b1.value[j];
          const off = j * D;
          for (let d = 0; d < D; d++) z += w1.value[off + d] * x[d];
          hPre[j] = z;
          h[j] = z > 0 ? z : 0;
        }

        let max = -Infinity;
        for (let k = 0; k < K; k++) {
          let z = b2.value[k];
          const off = k * H;
          for (let j = 0; j < H; j++) z += w2.value[off + j] * h[j];
          logits[k] = z;
          if (z > max) max = z;
        }
        let sum = 0;
        for (let k = 0; k < K; k++) {
          logits[k] = Math.exp(logits[k] - max);
          sum += logits[k];
        }
        for (let k = 0; k < K; k++) logits[k] /= sum;

        dh.fill(0);
        for (let k = 0; k < K; k++) {
          const dz = logits[k] - (k === y ? 1 : 0);
          b2.accumulate(k, dz);
          const off = k * H;
          for (let j = 0; j < H; j++) {
            w2.accumulate(off + j, dz * h[j]);
            dh[j] += w2.value[off + j] * dz;
          }
        }

        for (let j = 0; j < H; j++) {
          if (hPre[j] <= 0) continue;
          const g = dh[j];
          b1.accumulate(j, g);
          const off = j * D;
          for (let d = 0; d < D; d++) w1.accumulate(off + d, g * x[d]);
        }
      }

      stepCount++;
      // Adam bias correction. Folded into the step size rather than applied to
      // the moments, which is the same arithmetic with less bookkeeping.
      const b1c = 1 - Math.pow(0.9, stepCount);
      const b2c = 1 - Math.pow(0.999, stepCount);
      const lrHat = (cfg.learningRate * Math.sqrt(b2c)) / b1c;
      const scale = 1 / batch;
      w1.step(lrHat, scale);
      b1.step(lrHat, scale);
      w2.step(lrHat, scale);
      b2.step(lrHat, scale);
    }
  }

  const head: MlpHead = {
    kind: 'mlp',
    version: CALIBRATION_VERSION,
    labels,
    hidden: H,
    w1: w1.value,
    b1: b1.value,
    w2: w2.value,
    b2: b2.value,
    trainAccuracy: 0,
    holdoutAccuracy: null,
    updatedAt: Date.now(),
  };
  head.trainAccuracy = scoreMlpHead(head, samples);
  return head;
}
