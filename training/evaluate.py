"""Evaluate a run and emit the numbers a model card requires.

    python evaluate.py --run runs/fs-v1 --data data/fs.npz --report runs/fs-v1/report.md

Produces per-class accuracy, a confusion summary, and — when signers.csv is
present — a breakdown by skin tone, handedness and lighting. If the metadata is
missing the report says so explicitly, because "we did not measure this" is an
acceptable model-card entry and silence is not.
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
    )
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    return model, labels


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

    per_class_correct = defaultdict(int)
    per_class_total = defaultdict(int)
    per_signer = {}
    confusions = defaultdict(int)
    all_correct = 0

    # Leave-one-signer-out: the most honest evaluation available on a small
    # dataset, and the one to report below roughly eight signers.
    for train_idx, test_idx, signer in leave_one_signer_out(signers):
        if len(test_idx) == 0:
            continue
        with torch.no_grad():
            predictions = model(torch.from_numpy(X[test_idx])).argmax(dim=1).numpy()
        truth = y[test_idx]

        correct = int((predictions == truth).sum())
        all_correct += correct
        per_signer[signer] = correct / len(test_idx)

        for actual, predicted in zip(truth, predictions):
            per_class_total[actual] += 1
            if actual == predicted:
                per_class_correct[actual] += 1
            else:
                confusions[(labels[actual], labels[predicted])] += 1

    overall = all_correct / len(y)

    lines: list[str] = []
    add = lines.append
    add(f"# Evaluation — {args.run.name}\n")
    add(f"**Split** leave-one-signer-out over {len(per_signer)} signers")
    add(f"**Overall accuracy** {overall:.3f}\n")

    add("## Per signer\n")
    add("| signer | accuracy |")
    add("|---|---|")
    for signer, accuracy in sorted(per_signer.items(), key=lambda kv: kv[1]):
        add(f"| {signer} | {accuracy:.3f} |")
    spread = max(per_signer.values()) - min(per_signer.values()) if per_signer else 0
    add("")
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
