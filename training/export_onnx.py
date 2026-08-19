"""Export a trained run to ONNX, verify it, and print the manifest entry.

    python export_onnx.py --run runs/fs-v1 --out ../public/models/fingerspell-v1.onnx

Verification is not optional: the exported graph is run against the PyTorch
model on random input and the outputs must agree. A silently-wrong export is
worse than a failed one, because it produces plausible captions.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch

from evaluate import load_run


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--opset", type=int, default=17)
    parser.add_argument("--tolerance", type=float, default=1e-4)
    args = parser.parse_args()

    model, labels = load_run(args.run)
    checkpoint = torch.load(args.run / "model.pt", map_location="cpu", weights_only=False)
    input_dim = checkpoint["input_dim"]
    frames = checkpoint.get("frames")
    is_temporal = checkpoint["arch"] in {"gru", "transformer", "ctc"}

    dummy = (
        torch.randn(1, frames or 64, input_dim) if is_temporal else torch.randn(1, input_dim)
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        dummy,
        str(args.out),
        input_names=["features"],
        output_names=["logits"],
        opset_version=args.opset,
        dynamic_axes={"features": {0: "batch"}, "logits": {0: "batch"}},
    )

    # --- verify
    import onnxruntime as ort

    session = ort.InferenceSession(str(args.out), providers=["CPUExecutionProvider"])
    probe = dummy.numpy()
    onnx_out = session.run(["logits"], {"features": probe})[0]
    with torch.no_grad():
        torch_out = model(dummy).numpy()

    difference = float(np.abs(onnx_out - torch_out).max())
    if difference > args.tolerance:
        args.out.unlink(missing_ok=True)
        raise SystemExit(
            f"Export verification FAILED: max difference {difference:.2e} exceeds "
            f"{args.tolerance:.0e}. The ONNX graph does not match the PyTorch model. "
            "Deleted the output rather than shipping a model that produces plausible "
            "but wrong captions."
        )

    digest = hashlib.sha256(args.out.read_bytes()).hexdigest()
    entry = {
        "id": args.out.stem,
        "file": f"/models/{args.out.name}",
        "sha256": digest,
        "labels": labels,
        "inputName": "features",
        "outputName": "logits",
        "inputDim": input_dim * (frames or 1) if is_temporal else input_dim,
        "card": "/docs/MODELS.md",
        "version": args.run.name,
    }

    size_mb = args.out.stat().st_size / 1024 / 1024
    print(f"Exported {args.out}  ({size_mb:.2f} MB)")
    print(f"Verified against PyTorch: max difference {difference:.2e}\n")
    print("Add this to public/models/manifest.json under \"models\":\n")
    print(json.dumps(entry, indent=2))
    print(
        "\nThen write its card in docs/MODELS.md. The app refuses to load a model whose\n"
        "hash does not match, and a model without a card does not ship."
    )


if __name__ == "__main__":
    main()
