"""Train the fingerspelling MLP.

    python train_fingerspell.py --data data/fs.npz --out runs/fs-v1

Splits by signer. Refuses to split any other way.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from models import FingerspellMLP
from splits import check_class_coverage, signer_split


def augment(X: np.ndarray, rng: np.random.Generator, jitter: float = 0.015) -> np.ndarray:
    """Gaussian jitter on landmark coordinates.

    Stands in for the real-world variation the feature pipeline does not already
    remove: landmark estimation noise, slightly different finger placement. It
    is not a substitute for more signers — it cannot invent a hand shape the
    dataset has never seen.
    """
    return X + rng.normal(0.0, jitter, X.shape).astype(np.float32)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--epochs", type=int, default=120)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=2e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--hidden", type=int, default=128)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)

    blob = np.load(args.data, allow_pickle=True)
    X = blob["X"].astype(np.float32)
    y = blob["y"].astype(np.int64)
    labels = [str(s) for s in blob["labels"]]
    signers = blob["signers"]

    if X.ndim != 2 or X.shape[1] != 63:
        raise SystemExit(f"Expected (N, 63) features, got {X.shape}. Wrong task?")

    train_idx, test_idx, held_out = signer_split(signers, seed=args.seed)
    missing = check_class_coverage(y, test_idx, len(labels))
    if missing:
        print(
            f"WARNING: held-out signers do not perform {[labels[c] for c in missing]}. "
            "Their accuracy will be unmeasured."
        )

    print(f"train {len(train_idx)} · test {len(test_idx)} · held-out signers {held_out}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = FingerspellMLP(len(labels), input_dim=63, hidden=args.hidden).to(device)

    train_ds = TensorDataset(
        torch.from_numpy(augment(X[train_idx], rng)), torch.from_numpy(y[train_idx])
    )
    loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, drop_last=len(train_idx) > args.batch_size)

    X_test = torch.from_numpy(X[test_idx]).to(device)
    y_test = torch.from_numpy(y[test_idx]).to(device)

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    # Label smoothing helps here specifically because several classes genuinely
    # overlap (M/N/S/T/E) — forcing full confidence on them teaches overconfidence.
    criterion = nn.CrossEntropyLoss(label_smoothing=0.05)

    best_accuracy = 0.0
    args.out.mkdir(parents=True, exist_ok=True)

    for epoch in range(args.epochs):
        model.train()
        total = 0.0
        for xb, yb in loader:
            xb, yb = xb.to(device), yb.to(device)
            optimizer.zero_grad()
            loss = criterion(model(xb), yb)
            loss.backward()
            optimizer.step()
            total += loss.item() * len(xb)
        scheduler.step()

        model.eval()
        with torch.no_grad():
            predictions = model(X_test).argmax(dim=1)
            accuracy = (predictions == y_test).float().mean().item()

        if accuracy > best_accuracy:
            best_accuracy = accuracy
            torch.save(
                {
                    "state_dict": model.state_dict(),
                    "labels": labels,
                    "input_dim": 63,
                    "hidden": args.hidden,
                    "arch": "mlp",
                },
                args.out / "model.pt",
            )

        if epoch % 10 == 0 or epoch == args.epochs - 1:
            print(
                f"epoch {epoch:3d}  loss {total / len(train_idx):.4f}  "
                f"held-out signer acc {accuracy:.3f}"
            )

    (args.out / "run.json").write_text(
        json.dumps(
            {
                "data": str(args.data),
                "labels": labels,
                "held_out_signers": held_out,
                "best_holdout_accuracy": best_accuracy,
                "epochs": args.epochs,
                "seed": args.seed,
                "split": "held-out-signer",
            },
            indent=2,
        )
    )

    print(f"\nBest held-out-signer accuracy: {best_accuracy:.3f}")
    print(f"Saved to {args.out}")
    if best_accuracy < 0.9:
        print(
            "\nBelow the 90% Phase 1 target. Do NOT lower the app's confidence threshold to\n"
            "compensate — collect more signers, or report the number honestly in the model card."
        )


if __name__ == "__main__":
    main()
