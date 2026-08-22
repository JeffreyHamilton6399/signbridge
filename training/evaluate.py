"""Evaluate a run and emit the numbers a model card requires.

    python evaluate.py --run runs/fs-v1 --data data/fs.npz --report runs/fs-v1/report.md

Produces per-class accuracy, a confusion summary, and — when signers.csv is
present — a breakdown by skin tone, handedness and lighting. If the metadata is
missing the report says so explicitly, because "we did not measure this" is an
acceptable model-card entry and silence is not.

Every headline number is computed over signers the model never saw, read from
the run's run.json. Signers that were in training are reported too, labelled and
excluded from the totals — the gap between the two is the most informative thing
in the report.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch

from models import build
from splits import leave_one_signer_out


def load_run(run: Path):
    checkpoint = torch.load(run / "model.pt", map_location="cpu", weights_only=False)
    labels = checkpoint["labels"]
    model = build(
        checkpoint["arch"],
        len(labels),
        checkpoint["input_dim"],
        frames=checkpoint.get("frames", 64),
        # Absent in checkpoints written before this was saved; build() falls
        # back to the constructor default, which is what those were trained at.
        hidden=checkpoint.get("hidden"),
    )
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    return model, labels


def load_held_out(run: Path) -> list[str]:
    """The signers train_*.py kept out of this run, from its run.json."""
    try:
        return list(json.loads((run / "run.json").read_text())["held_out_signers"])
    except (OSError, ValueError, KeyError):
        return []


def load_signer_metadata(data_path: Path) -> dict[str, dict[str, str]] | None:
    """Optional signers.csv sitting beside the source media directory."""
    try:
        import pandas as pd
    except ImportError:
        return None

    meta_blob = np.load(data_path, allow_pickle=True)
    try:
        source = Path(json.loads(str(meta_blob["meta"]))["input"])
    except (KeyError, ValueError):
        return None

    csv_path = source / "signers.csv"
    if not csv_path.exists():
        return None
    frame = pd.read_csv(csv_path, dtype=str).fillna("unknown")
    return {row["signer_id"]: dict(row) for _, row in frame.iterrows()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, type=Path)
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    model, labels = load_run(args.run)
    blob = np.load(args.data, allow_pickle=True)
    X = blob["X"].astype(np.float32)
    y = blob["y"].astype(np.int64)
    signers = blob["signers"]
    metadata = load_signer_metadata(args.data)

    # Which signers this model never saw.
    #
    # This used to loop over every signer in the dataset and average the lot,
    # under the heading "leave-one-signer-out". It was not that: the model is
    # trained once, on a fixed split, and is never refitted per fold — so for
    # the ~75% of signers that were in its training set, the fold was measuring
    # training accuracy. Those folds then went into "Overall accuracy" and into
    # the per-class table underneath it.
    #
    # That is the exact inflation this pipeline exists to avoid, printed by the
    # script whose job is to catch it. The headline number is now computed over
    # held-out signers only; the training signers are still reported, clearly
    # labelled, because the gap between the two is itself worth seeing.
    held_out = set(load_held_out(args.run))
    if not held_out:
        raise SystemExit(
            f"{args.run}/run.json does not record which signers were held out, so there is no "
            "way to tell an honest number from an inflated one. Retrain with the current "
            "train_*.py, which records them."
        )
    unknown = held_out - set(signers.tolist())
    if unknown:
        raise SystemExit(
            f"Held-out signers {sorted(unknown)} are not in {args.data}. This run was trained "
            "against a different dataset, and evaluating it here would report a meaningless "
            "number."
        )

    per_class_correct = defaultdict(int)
    per_class_total = defaultdict(int)
    per_signer = {}
    train_signer_accuracy = {}
    confusions = defaultdict(int)
    all_correct = 0
    all_total = 0

    for _, test_idx, signer in leave_one_signer_out(signers):
        if len(test_idx) == 0:
            continue
        with torch.no_grad():
            predictions = model(torch.from_numpy(X[test_idx])).argmax(dim=1).numpy()
        truth = y[test_idx]
        correct = int((predictions == truth).sum())

        if signer not in held_out:
            # Kept for the contrast, excluded from everything reportable.
            train_signer_accuracy[signer] = correct / len(test_idx)
            continue

        all_correct += correct
        all_total += len(test_idx)
        per_signer[signer] = correct / len(test_idx)

        for actual, predicted in zip(truth, predictions):
            per_class_total[actual] += 1
            if actual == predicted:
                per_class_correct[actual] += 1
            else:
                confusions[(labels[actual], labels[predicted])] += 1

    overall = all_correct / all_total if all_total else 0.0

    lines: list[str] = []
    add = lines.append
    add(f"# Evaluation — {args.run.name}\n")
    add(f"**Split** held-out signer, {len(per_signer)} signer(s) this model never saw")
    add(f"**Overall accuracy** {overall:.3f}  *(held-out signers only)*\n")

    if len(per_signer) < 3:
        add(
            f"> Only {len(per_signer)} held-out signer(s). One person's hands are not a "
            "population, and this number will move a lot with the next signer added. Report "
            "it with the count beside it, always.\n"
        )

    add("## Per signer\n")
    add("| signer | accuracy | in training? |")
    add("|---|---|---|")
    for signer, accuracy in sorted(per_signer.items(), key=lambda kv: kv[1]):
        add(f"| {signer} | {accuracy:.3f} | no |")
    for signer, accuracy in sorted(train_signer_accuracy.items(), key=lambda kv: kv[1]):
        add(f"| {signer} | {accuracy:.3f} | **yes — not counted above** |")
    spread = max(per_signer.values()) - min(per_signer.values()) if per_signer else 0
    add("")

    if train_signer_accuracy:
        seen = float(np.mean(list(train_signer_accuracy.values())))
        add(
            f"> Training signers average {seen:.3f} against {overall:.3f} held out, a gap of "
            f"{seen - overall:+.3f}. A large gap means the model has learned these particular "
            "people rather than the language. Only the held-out number belongs in a model card.\n"
        )
    if spread > 0.2:
        add(
            f"> Spread across signers is {spread:.2f}. That is large: this model works "
            "noticeably better for some people than others, and the model card must say so.\n"
        )

    add("## Per class\n")
    add("| class | accuracy | n |")
    add("|---|---|---|")
    for index in sorted(per_class_total, key=lambda c: per_class_correct[c] / per_class_total[c]):
        accuracy = per_class_correct[index] / per_class_total[index]
        add(f"| {labels[index]} | {accuracy:.3f} | {per_class_total[index]} |")
    add("")

    add("## Most common confusions\n")
    add("| actual | predicted | count |")
    add("|---|---|---|")
    for (actual, predicted), count in sorted(confusions.items(), key=lambda kv: -kv[1])[:20]:
        add(f"| {actual} | {predicted} | {count} |")
    add("")

    add("## Demographic breakdown\n")
    if metadata is None:
        add(
            "**Unavailable.** No `signers.csv` was found beside the source media, so accuracy "
            "cannot be broken down by skin tone, handedness or Deaf status. State this "
            "explicitly in the model card — do not omit the section.\n"
        )
    else:
        for field in ("skin_tone_monk", "handedness", "deaf_status", "l1_asl"):
            groups = defaultdict(list)
            for signer, accuracy in per_signer.items():
                groups[metadata.get(signer, {}).get(field, "unknown")].append(accuracy)
            if len(groups) <= 1:
                continue
            add(f"### by {field}\n")
            add("| value | mean accuracy | signers |")
            add("|---|---|---|")
            for value, accuracies in sorted(groups.items()):
                add(f"| {value} | {np.mean(accuracies):.3f} | {len(accuracies)} |")
            add("")

    report = "\n".join(lines)
    print(report)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(report, encoding="utf-8")
        print(f"\nWrote {args.report}")


if __name__ == "__main__":
    main()
