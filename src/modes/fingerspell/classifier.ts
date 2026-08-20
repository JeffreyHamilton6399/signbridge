/**
 * Fingerspelling classifier.
 *
 * Three sources of evidence, blended in this order of preference:
 *   1. an ONNX MLP, if one has been shipped in /public/models  (best)
 *   2. the user's own calibration prototypes, if they have run calibration
 *   3. the geometric templates in letterTemplates.ts            (always present)
 *
 * The blend weight for (2) grows with the number of samples the user recorded,
 * so a half-finished calibration nudges the prior instead of overriding it. If
 * nothing is calibrated and no model is loaded, you get (3) alone, which works
 * out of the box and is honest about its confidence.
 */
import type { HandFrame } from '@/vision/types';
import { geometryOf } from '@/features/handGeometry';
import type { HandGeometry } from '@/features/handGeometry';
import { normalizeHand, toFeatureVector, squaredDistance } from '@/features/normalize';
import { LETTER_TEMPLATES, STATIC_LETTERS } from './letterTemplates';
import type { LetterPrototypes } from './calibration';

export interface Candidate {
  label: string;
  confidence: number;
}

export interface LetterPrediction {
  /** Highest-scoring label, or null when nothing clears the noise floor. */
  label: string | null;
  confidence: number;
  /** Top 3 including the winner, descending. */
  alternates: Candidate[];
  /** Full distribution, for the debug overlay. */
  distribution: Record<string, number>;
  /** The 63-float vector this prediction was made from, for calibration capture. */
  features: Float32Array;
}

/** Sharpness of the template softmax. Lower = more confident, more brittle. */
const TEMPLATE_TEMPERATURE = 0.085;
/** Sharpness of the prototype distance softmax, in squared-distance units. */
const PROTOTYPE_TEMPERATURE = 0.55;

function softmax(scores: number[], temperature: number): number[] {
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

export interface OnnxLetterModel {
  labels: readonly string[];
  /** Returns a probability per label, same order as `labels`. */
  run(features: Float32Array): Promise<Float32Array>;
}

export class FingerspellClassifier {
  private prototypes: LetterPrototypes | null = null;
  private onnx: OnnxLetterModel | null = null;

  setPrototypes(p: LetterPrototypes | null): void {
    this.prototypes = p;
  }

  setOnnxModel(m: OnnxLetterModel | null): void {
    this.onnx = m;
  }

  get hasPersonalModel(): boolean {
    return (this.prototypes?.classes.length ?? 0) > 0;
  }

  /**
   * Classify a single frame. Synchronous on purpose: the geometric and
   * prototype paths are microseconds, and the caller runs at frame rate.
   * The ONNX path is exposed separately via {@link predictAsync}.
   */
  predict(hand: HandFrame, aspect = 1): LetterPrediction {
    const geom = geometryOf(hand, aspect);
    // The 63-float vector stays in image space deliberately. It is the space
    // every stored calibration sample and every trained artefact lives in
    // (see normalize.ts and training/normalize.py), so it cannot change without
    // invalidating them. Only the rules read world coordinates.
    const features = toFeatureVector(normalizeHand(hand.landmarks, hand.handedness, { aspect }));

    const priorProbs = this.templateProbabilities(geom);
    const merged = this.mergePersonal(priorProbs, features);

    return this.finish(merged, features);
  }

  /** Same as predict(), but consults a loaded ONNX model when available. */
  async predictAsync(hand: HandFrame, aspect = 1): Promise<LetterPrediction> {
    const base = this.predict(hand, aspect);
    if (!this.onnx) return base;

    const probs = await this.onnx.run(base.features);
    const dist: Record<string, number> = {};
    this.onnx.labels.forEach((label, i) => {
      dist[label] = probs[i] ?? 0;
    });
    // The trained model leads; the geometric prior only breaks near-ties, which
    // keeps the model honest when it is confidently wrong.
    for (const [label, p] of Object.entries(base.distribution)) {
      dist[label] = (dist[label] ?? 0) * 0.85 + p * 0.15;
    }
    const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
    for (const k of Object.keys(dist)) dist[k] /= total;

    return this.finish(dist, base.features);
  }

  private templateProbabilities(geom: HandGeometry): Record<string, number> {
    const raw = LETTER_TEMPLATES.map((t) => t.score(geom));
    const probs = softmax(raw, TEMPLATE_TEMPERATURE);
    const out: Record<string, number> = {};
    LETTER_TEMPLATES.forEach((t, i) => {
      out[t.letter] = probs[i];
    });
    return out;
  }

  private mergePersonal(
    prior: Record<string, number>,
    features: Float32Array,
  ): Record<string, number> {
    const proto = this.prototypes;
    if (!proto || proto.classes.length === 0) return prior;

    const labels = proto.classes.map((c) => c.label);
    const negDistances = proto.classes.map((c) => -squaredDistance(features, c.centroid));
    const personal = softmax(negDistances, PROTOTYPE_TEMPERATURE);

    const out: Record<string, number> = { ...prior };
    const totalSamples = proto.classes.reduce((a, c) => a + c.sampleCount, 0);
    // 5 samples per class is where the personal model starts to be trustworthy;
    // by ~10 per class it dominates.
    const coverage = Math.min(1, totalSamples / (STATIC_LETTERS.length * 8));
    const w = 0.15 + 0.75 * coverage;

    for (const label of Object.keys(out)) out[label] *= 1 - w;
    labels.forEach((label, i) => {
      out[label] = (out[label] ?? 0) + w * personal[i];
    });

    const total = Object.values(out).reduce((a, b) => a + b, 0) || 1;
    for (const k of Object.keys(out)) out[k] /= total;
    return out;
  }

  private finish(dist: Record<string, number>, features: Float32Array): LetterPrediction {
    const sorted = Object.entries(dist)
      .map(([label, confidence]) => ({ label, confidence }))
      .sort((a, b) => b.confidence - a.confidence);

    const top = sorted[0];
    return {
      label: top && top.confidence > 0 ? top.label : null,
      confidence: top?.confidence ?? 0,
      alternates: sorted.slice(0, 3),
      distribution: dist,
      features,
    };
  }
}

/** Feature vector for calibration capture, without running the classifier. */
export function featuresFor(hand: HandFrame, aspect = 1): Float32Array {
  return toFeatureVector(normalizeHand(hand.landmarks, hand.handedness, { aspect }));
}

/** Exposed for the debug overlay: the raw interpretable geometry of a hand. */
export function geometryFor(hand: HandFrame, aspect = 1) {
  return geometryOf(hand, aspect);
}
