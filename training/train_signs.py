"""Train the sign-level temporal model.

    python train_signs.py --data data/signs.npz --out runs/signs-v1 --arch gru

Scope the vocabulary tightly. 150 signs at 85% is a product; 2000 signs at 45%
is a demo that wastes people's time.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from models import build
from splits import check_class_coverage, signer_split

NO_SIGN = "<no-sign>"


def augment(X: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Jitter, time warp and a small global translation.

    Time warp matters most: it teaches the model that a sign performed slowly
    and the same sign performed quickly are the same sign, which is the single
    largest source of within-class variation after signer identity.
    """
    out = X.copy()
    out += rng.normal(0.0, 0.01, out.shape).astype(np.float32)

    # Global translation of the body-relative wrist positions only (last 8 dims).
    shift = rng.normal(0.0, 0.02, (len(out), 1, 6)).astype(np.float32)
    out[:, :, 126:132] += shift

    # Time warp by resampling each window with a random monotonic curve.
    frames = out.shape[1]
    for i in range(len(out)):
        strength = rng.uniform(0.75, 1.35)
        source = np.linspace(0.0, 1.0, frames)
        warped = np.clip(source**strength, 0.0, 1.0)
        for d in range(out.shape[2]):
            out[i, :, d] = np.interp(source, warped, out[i, :, d])
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--arch", choices=["gru", "transformer"], default="gru")
    parser.add_argument("--hidden", type=int, default=None, help="GRU width; default is the architecture default")
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)

    blob = np.load(args.data, allow_pickle=True)
    X = blob["X"].astype(np.float32)
    y = blob["y"].astype(np.int64)
    labels = [str(s) for s in blob["labels"]]
    signers = blob["signers"]

    if X.ndim != 3:
        raise SystemExit(f"Expected (N, frames, dim) features, got {X.shape}. Wrong task?")

    if NO_SIGN not in labels:
        print(
            f"WARNING: no '{NO_SIGN}' class in this dataset. Without it the recogniser will\n"
            "fire during every transition between signs. Record idle and transition clips."
        )
    if len(labels) > 300:
        print(
            f"WARNING: {len(labels)} classes. Accuracy per class falls fast beyond a few\n"
            "hundred. Consider scoping the vocabulary down."
        )

    train_idx, test_idx, held_out = signer_split(signers, seed=args.seed)
    missing = check_class_coverage(y, test_idx, len(labels))
    if missing:
        print(f"WARNING: {len(missing)} classes have no held-out examples.")

    print(f"train {len(train_idx)} · test {len(test_idx)} · held-out signers {held_out}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = build(
        args.arch, len(labels), X.shape[2], frames=X.shape[1], hidden=args.hidden
    ).to(device)

    train_ds = TensorDataset(
        torch.from_numpy(augment(X[train_idx], rng)), torch.from_numpy(y[train_idx])
    )
    loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True)

    X_test = torch.from_numpy(X[test_idx]).to(device)
    y_test = torch.from_numpy(y[test_idx]).to(device)

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    criterion = nn.CrossEntropyLoss(label_smoothing=0.05)

    best_top1 = 0.0
    args.out.mkdir(parents=True, exist_ok=True)

    for epoch in range(args.epochs):
        model.train()
        total = 0.0
        for xb, yb in loader:
            xb, yb = xb.to(device), yb.to(device)
            optimizer.zero_grad()
            loss = criterion(model(xb), yb)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total += loss.item() * len(xb)
        scheduler.step()

        model.eval()
        with torch.no_grad():
            logits = model(X_test)
            top1 = (logits.argmax(dim=1) == y_test).float().mean().item()
            k = min(5, len(labels))
            topk = logits.topk(k, dim=1).indices
            top5 = (topk == y_test.unsqueeze(1)).any(dim=1).float().mean().item()

        if top1 > best_top1:
            best_top1 = top1
            torch.save(
                {
                    "state_dict": model.state_dict(),
                    "labels": labels,
                    "input_dim": X.shape[2],
                    "frames": X.shape[1],
                    "arch": args.arch,
                    # Recorded so evaluate.py and export_onnx.py can rebuild
                    # this exact shape. Omitting it made runs unloadable.
                    "hidden": args.hidden,
                },
                args.out / "model.pt",
            )

        if epoch % 5 == 0 or epoch == args.epochs - 1:
            print(
                f"epoch {epoch:3d}  loss {total / len(train_idx):.4f}  "
                f"top-1 {top1:.3f}  top-5 {top5:.3f}"
            )

    (args.out / "run.json").write_text(
        json.dumps(
            {
                "data": str(args.data),
                "labels": labels,
                "arch": args.arch,
                "held_out_signers": held_out,
                "best_holdout_top1": best_top1,
                "split": "held-out-signer",
            },
            indent=2,
        )
    )

    print(f"\nBest held-out-signer top-1: {best_top1:.3f}")
    if best_top1 < 0.8:
        print(
            "\nBelow the 80% Phase 2 target. Shrink the vocabulary or collect more signers.\n"
            "Do not ship this and describe it as working."
        )


if __name__ == "__main__":
    main()
