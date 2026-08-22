"""Generate a synthetic .npz, so CI can run the training pipeline.

    python make_smoke_data.py --out data/smoke.npz --task fingerspell
    python make_smoke_data.py --out data/smoke-signs.npz --task signs

WHAT THIS IS FOR
----------------
This pipeline was written and, until now, never executed — there was no Python
on the machine it was authored on and no dataset to run it against. "Reviewed
code, not tested code" is a fair description of a lot of it, and the failure
mode of untested build tooling is that it breaks on the one day someone finally
has data and wants to train.

So CI runs the whole chain — train, evaluate, export, verify the ONNX against
PyTorch — on the output of this file. It catches import errors, shape errors,
argument drift between scripts, checkpoint keys that do not match what the
exporter reads, and ONNX opset problems. That is most of what actually goes
wrong on a first run.

WHAT THIS IS NOT
----------------
**Not data, and not a model.** The hands here are made up. A model trained on
them recognises nothing, its accuracy number means nothing, and it must never be
committed to public/models/ or written up in a model card. CI trains one, checks
it exports, and throws it away.

The generator is deliberately structured so the *pipeline's* honesty checks have
something real to bite on: several signers, each with a systematic deformation
of their own, so the held-out-signer split in splits.py is a genuine test rather
than a formality. Accuracy on held-out signers comes out well above chance and
well below perfect, which is the regime the reporting code is written for.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from normalize import PER_FRAME_DIM, WINDOW_FRAMES, hand_features

# The 24 static letters. J and Z are movements and are not single-frame classes.
LABELS = [
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "K", "L", "M",
    "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y",
]

MCP_X = np.array([-0.36, -0.12, 0.12, 0.34])
SEGMENTS = np.array([0.38, 0.26, 0.2])


def hand(curls: np.ndarray, thumb: np.ndarray, spread: float) -> np.ndarray:
    """21 landmarks from four finger curls and a thumb tip.

    Fingers are articulated as chains, so a curl moves three points together the
    way a real one does. Independently placed points would give the classifier
    correlations no hand has, and the pipeline would look like it worked.
    """
    pts = [np.zeros(3)]

    base = np.array([-0.3, 0.22, 0.04])
    for i in range(1, 5):
        t = i / 4
        bow = np.sin(t * np.pi) * 0.06
        pts.append(base + (thumb - base) * t + np.array([bow, 0.0, bow * 0.5]))

    for f in range(4):
        lean = (MCP_X[f] / 0.36) * spread * 0.28
        x, y, z = MCP_X[f] + lean * 0.3, 1.0, 0.0
        pts.append(np.array([x, y, z]))
        angle = 0.0
        for length in SEGMENTS:
            angle += curls[f] * 1.45
            x += lean * 0.22
            y += np.cos(angle) * length
            z -= np.sin(angle) * length
            pts.append(np.array([x, y, z]))

    return np.stack(pts)


def canonical_letters(rng: np.random.Generator) -> dict[str, tuple[np.ndarray, np.ndarray, float]]:
    """One made-up but distinct pose per letter."""
    out = {}
    for i, label in enumerate(LABELS):
        # Deterministic per label, and spread across the space rather than
        # random, so no two letters land on top of each other by accident.
        phase = i / len(LABELS)
        curls = np.clip(
            0.5 + 0.5 * np.sin(2 * np.pi * (phase + np.arange(4) * 0.17)), 0.0, 1.0
        )
        thumb = np.array(
            [-0.5 + phase * 0.9, 0.45 + 0.4 * np.cos(2 * np.pi * phase), 0.25 * np.sin(4 * phase)]
        )
        out[label] = (curls, thumb, float(rng.uniform(0, 0.9)))
    return out


def tilt(points: np.ndarray, ax: float, ay: float) -> np.ndarray:
    cx, sx, cy, sy = np.cos(ax), np.sin(ax), np.cos(ay), np.sin(ay)
    y1 = points[:, 1] * cx - points[:, 2] * sx
    z1 = points[:, 1] * sx + points[:, 2] * cx
    x2 = points[:, 0] * cy + z1 * sy
    z2 = -points[:, 0] * sy + z1 * cy
    return np.stack([x2, y1, z2], axis=1)


def signs_arrays(
    rng: np.random.Generator, signers_count: int, per_class: int
) -> tuple[np.ndarray, np.ndarray, list[str], np.ndarray]:
    """A (N, 64, 134) window dataset for the temporal pipeline.

    Built directly rather than through frame_features, because the point is to
    exercise train_signs.py, the temporal export path and its dynamic axes —
    not to re-test feature extraction, which the fingerspell task already
    covers and test_parity.py pins.

    ``<no-sign>`` is included because the pipeline requires it. It is the class
    that stops the recogniser firing during every transition, it is routinely
    forgotten, and a smoke dataset without it would let a regression that drops
    it pass unnoticed.
    """
    labels = [f"SIGN-{i:02d}" for i in range(8)] + ["<no-sign>"]
    frames, dim = WINDOW_FRAMES, PER_FRAME_DIM

    # One smooth trajectory per class: a low-frequency curve over the window,
    # which is roughly what a real feature sequence looks like and is enough
    # structure for a temporal model to have something to fit.
    t = np.linspace(0, 1, frames)[:, None]
    templates = []
    for i in range(len(labels)):
        freq = 1 + (i % 4)
        phase = 2 * np.pi * i / len(labels)
        base = rng.normal(0, 0.4, (1, dim))
        templates.append(base + 0.6 * np.sin(2 * np.pi * freq * t + phase) * rng.normal(0, 0.5, (1, dim)))

    X, y, signers = [], [], []
    for s in range(signers_count):
        signer_id = f"synthetic-s{s:02d}"
        signer_bias = rng.normal(0, 0.15, (1, dim))
        for ci in range(len(labels)):
            for _ in range(per_class):
                window = templates[ci] + signer_bias + rng.normal(0, 0.18, (frames, dim))
                X.append(window.astype(np.float32))
                y.append(ci)
                signers.append(signer_id)

    return np.stack(X), np.array(y, dtype=np.int64), labels, np.array(signers)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--task", choices=["fingerspell", "signs"], default="fingerspell")
    parser.add_argument("--signers", type=int, default=6)
    parser.add_argument("--per-letter", type=int, default=12)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    rng = np.random.default_rng(args.seed)

    if args.task == "signs":
        X, y, labels, signers = signs_arrays(rng, args.signers, args.per_letter)
        write(args, X, y, labels, signers)
        return

    letters = canonical_letters(rng)
    X, y, signers = [], [], []
    for s in range(args.signers):
        signer_id = f"synthetic-s{s:02d}"
        # Each signer holds their hand at their own angle and forms letters
        # slightly differently. This is what makes the held-out-signer split
        # measure something.
        signer_ax = rng.uniform(-0.25, 0.25)
        signer_ay = rng.uniform(-0.25, 0.25)
        signer_curl_bias = rng.normal(0, 0.06, 4)

        for li, label in enumerate(LABELS):
            curls, thumb, spread = letters[label]
            for _ in range(args.per_letter):
                pts = hand(
                    np.clip(curls + signer_curl_bias + rng.normal(0, 0.04, 4), 0, 1),
                    thumb + rng.normal(0, 0.03, 3),
                    spread,
                )
                pts = tilt(pts, signer_ax + rng.normal(0, 0.06), signer_ay + rng.normal(0, 0.06))
                pts = pts + rng.normal(0, 0.006, pts.shape)
                # Through the real feature pipeline, so this exercises
                # normalize.py and produces vectors on the same manifold as
                # inference rather than a lookalike.
                X.append(hand_features(pts, handedness="Right", aspect=1.0))
                y.append(li)
                signers.append(signer_id)

    write(args, np.stack(X).astype(np.float32), np.array(y, dtype=np.int64), LABELS, np.array(signers))


def write(
    args: argparse.Namespace,
    X: np.ndarray,
    y: np.ndarray,
    labels: list[str],
    signers: np.ndarray,
) -> None:
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.out,
        X=X,
        y=y,
        labels=np.array(labels),
        signers=signers,
        meta=json.dumps(
            {
                "SYNTHETIC": True,
                "warning": (
                    "Made-up hands. A model trained on this recognises nothing. "
                    "Never ship it and never put its accuracy in a model card."
                ),
                "generator": "training/make_smoke_data.py",
                "task": args.task,
                "signers": args.signers,
                "per_letter": args.per_letter,
                "seed": args.seed,
                "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        ),
    )

    print(f"Wrote {args.out}: X{X.shape}, {len(labels)} labels, {args.signers} signers")
    print("SYNTHETIC — for exercising the pipeline only. Not data. Not a model.")


if __name__ == "__main__":
    main()
