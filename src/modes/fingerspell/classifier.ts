/**
 * Fingerspelling classifier.
 *
 * Sources of evidence, blended in this order of preference:
 *   1. an ONNX model, if one has been shipped in /public/models (best; none yet)
 *   2. a head fitted locally from the user's own samples — a small MLP once
 *      there are enough of them, a linear head below that (see mlpHead.ts)
 *   3. nearest-centroid prototypes over those same samples
 *   4. the geometric templates in letterTemplates.ts           (always present)
 *
 * (2) and (3) both grow in influence with the number of samples recorded, so a
 * thin calibration nudges the prior instead of overriding it. With nothing
 * calibrated you get (4) alone, which works out of the box and is honest about
 * its confidence.
 *
 * **Both personal heads are confined to the letters they have seen.** They
 * redistribute the probability mass already sitting on those letters and leave
 * every other letter untouched. That is what makes a partial calibration safe,
 * and it is what lets someone record six fist letters in ninety seconds and get
 * the benefit without having to sit through all twenty-four.
 */
import type { HandFrame } from '@/vision/types';
import { geometryOf } from '@/features/handGeometry';
import type { HandGeometry } from '@/features/handGeometry';
import { normalizeHand, toFeatureVector, squaredDistance } from '@/features/normalize';
import { LETTER_TEMPLATES } from './letterTemplates';
import { runFittedHead } from './mlpHead';
import type { FittedHead } from './mlpHead';
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
  /** The interpretable geometry behind it — reused so callers need not recompute. */
  geometry: HandGeometry;
}

/** Sharpness of the template softmax. Lower = more confident, more brittle. */
const TEMPLATE_TEMPERATURE = 0.085;
/** Examples of its rarest letter a fitted head needs before it is consulted. */
const MIN_HEAD_SAMPLES = 3;
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
  private head: FittedHead | null = null;

  setPrototypes(p: LetterPrototypes | null): void {
    this.prototypes = p;
  }

  setOnnxModel(m: OnnxLetterModel | null): void {
    this.onnx = m;
  }

  /**
   * The locally-fitted personal head — an MLP or a linear head, whichever the
   * sample count justified when it was fitted. {@link runFittedHead} dispatches.
   *
   * This is separate from {@link setOnnxModel} because it is not async: even the
   * MLP is about 4,000 multiply-adds, microseconds, so it runs inside
   * {@link predict} on the frame path. It was previously routed through the ONNX
   * slot, which
   * only `predictAsync` consults — and nothing calls `predictAsync`. So the
   * better of the two personal heads was fitted, stored, and never once used to
   * classify a frame. Everything personalization did was coming from the
   * nearest-centroid prototypes alone.
   *
   * That matters most for exactly the letters it was meant to fix. Distance to
   * a centroid weights all 63 dimensions equally, so a T and an A that differ
   * in a handful of coordinates and agree in the rest come out nearly
   * equidistant. A fitted head learns which coordinates carry the difference.
   */
  setLocalHead(h: FittedHead | null): void {
    this.head = h;
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
    const merged = this.mergeHead(this.mergePersonal(priorProbs, features), features);

    return this.finish(merged, features, geom);
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

    return this.finish(dist, base.features, base.geometry);
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

    // Confined to the letters it has actually seen, exactly as the fitted head
    // is. This used to scale every letter down by the blend weight and then add
    // the personal mass back only to the calibrated ones, which meant a
    // half-finished calibration handed a third of all probability to whichever
    // letters happened to get recorded, whatever the hand was doing. Anyone who
    // stopped partway through was quietly making the app worse.
    const totalSamples = proto.classes.reduce((a, c) => a + c.sampleCount, 0);
    const perClass = totalSamples / proto.classes.length;
    // ~5 samples of a letter is where its centroid starts to be trustworthy;
    // by ~8 it should lead.
    const w = 0.15 + 0.75 * Math.min(1, perClass / 8);
    const mass = labels.reduce((a, label) => a + (prior[label] ?? 0), 0);
    if (mass <= 0) return prior;

    const out: Record<string, number> = { ...prior };
    labels.forEach((label, i) => {
      out[label] = (1 - w) * (prior[label] ?? 0) + w * mass * personal[i];
    });
    return out;
  }

  /**
   * Fold in the locally-fitted head, over the letters it actually knows.
   *
   * The head is confined to its own labels and the mass currently sitting on
   * them is redistributed according to it; every other letter is left exactly
   * as it was. That confinement is what makes a partial calibration safe — a
   * head fitted on six fist letters should sharpen those six and have no
   * opinion whatsoever about B, and without this it would have to be trained on
   * all twenty-four or not used at all.
   */
  private mergeHead(
    dist: Record<string, number>,
    features: Float32Array,
  ): Record<string, number> {
    const head = this.head;
    if (!head || head.labels.length < 2) return dist;

    // Sample counts live on the prototypes, which are built from the same set
    // in the same breath, so they are the honest measure of how much this head
    // has actually seen.
    const counts = new Map(this.prototypes?.classes.map((c) => [c.label, c.sampleCount]) ?? []);
    const leastSeen = Math.min(...head.labels.map((l) => counts.get(l) ?? 0));
    // Silent below three examples of its rarest class, then ramping to full
    // voice at six.
    //
    // That floor was put here for the linear head, which on one or two samples
    // per class memorised rather than generalised and came out almost one-hot —
    // confident enough to override the prototypes at any blend weight. The MLP
    // does not have that failure: augmentation means two samples still produce
    // hundreds of distinct training vectors, and measured across sessions it
    // beats both the prototypes and the old head even at two.
    //
    // The floor stays anyway. Those measurements are on synthetic hands, and
    // loosening a safety threshold is not something to do on synthetic
    // evidence — the cost of being wrong is a confidently wrong letter, and the
    // cost of leaving it is that one correction (which files three frames)
    // switches the head on regardless.
    if (leastSeen < MIN_HEAD_SAMPLES) return dist;
    const weight = 0.8 * Math.min(1, leastSeen / 6);

    const probs = runFittedHead(head, features);
    const mass = head.labels.reduce((a, l) => a + (dist[l] ?? 0), 0);
    if (mass <= 0) return dist;

    const out = { ...dist };
    head.labels.forEach((label, i) => {
      out[label] = (1 - weight) * (dist[label] ?? 0) + weight * mass * probs[i];
    });
    return out;
  }

  private finish(
    dist: Record<string, number>,
    features: Float32Array,
    geometry: HandGeometry,
  ): LetterPrediction {
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
      geometry,
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
