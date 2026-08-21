"""Model definitions.

Small on purpose. These run in a browser tab on a phone alongside MediaPipe;
a model that is 2% more accurate and 10x slower loses.
"""

from __future__ import annotations

import torch
import torch.nn as nn


class FingerspellMLP(nn.Module):
    """63 -> 24 static letters.

    Two hidden layers is enough for this problem — the input is already a
    normalized, rotation-invariant pose, so most of the work has been done by
    the feature pipeline rather than the network.
    """

    def __init__(self, num_classes: int, input_dim: int = 63, hidden: int = 128, dropout: float = 0.3):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden),
            nn.BatchNorm1d(hidden),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden, hidden // 2),
            nn.BatchNorm1d(hidden // 2),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden // 2, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class MotionLetterHead(nn.Module):
    """12-frame trajectory -> {J, Z, neither}.

    J and Z are movements, not poses. Forced through the static head they would
    only ever look like I and D.
    """

    def __init__(self, input_dim: int = 63, hidden: int = 64, frames: int = 12):
        super().__init__()
        self.frames = frames
        self.gru = nn.GRU(input_dim, hidden, batch_first=True, bidirectional=True)
        self.head = nn.Linear(hidden * 2, 3)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.gru(x)
        return self.head(out[:, -1])


class SignGRU(nn.Module):
    """64-frame window -> sign vocabulary, including a <no-sign> class.

    Bidirectional because a sign's identity often depends on how it ends —
    reading the window in both directions costs little and helps measurably.
    """

    def __init__(
        self,
        num_classes: int,
        input_dim: int = 134,
        hidden: int = 192,
        layers: int = 2,
        dropout: float = 0.3,
    ):
        super().__init__()
        self.gru = nn.GRU(
            input_dim,
            hidden,
            num_layers=layers,
            batch_first=True,
            bidirectional=True,
            dropout=dropout if layers > 1 else 0.0,
        )
        self.norm = nn.LayerNorm(hidden * 2)
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(hidden * 2, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.gru(x)
        # Mean-pool over time rather than taking the last state: a sign's
        # meaning is spread across the window, not concentrated at its end.
        pooled = self.norm(out.mean(dim=1))
        return self.head(self.dropout(pooled))


class SignTransformer(nn.Module):
    """4-layer encoder alternative. Better with more data, worse with less."""

    def __init__(
        self,
        num_classes: int,
        input_dim: int = 134,
        d_model: int = 192,
        heads: int = 6,
        layers: int = 4,
        dropout: float = 0.2,
        frames: int = 64,
    ):
        super().__init__()
        self.project = nn.Linear(input_dim, d_model)
        self.position = nn.Parameter(torch.randn(1, frames, d_model) * 0.02)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=heads,
            dim_feedforward=d_model * 4,
            dropout=dropout,
            batch_first=True,
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=layers)
        self.head = nn.Linear(d_model, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.project(x) + self.position[:, : x.shape[1]]
        h = self.encoder(h)
        return self.head(h.mean(dim=1))


class SignCTC(nn.Module):
    """Continuous recognition head: per-frame logits for CTC decoding.

    Class 0 is the CTC blank. See src/modes/conversation/ctc.ts for the decoder
    this pairs with, and read docs/ETHICS.md before shipping anything trained
    with it — continuous ASL recognition is an open research problem and this
    architecture does not solve it.
    """

    def __init__(self, num_classes: int, input_dim: int = 134, hidden: int = 256, layers: int = 3):
        super().__init__()
        self.gru = nn.GRU(
            input_dim, hidden, num_layers=layers, batch_first=True, bidirectional=True, dropout=0.3
        )
        self.head = nn.Linear(hidden * 2, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.gru(x)
        return self.head(out)  # (batch, frames, classes)


def build(
    arch: str,
    num_classes: int,
    input_dim: int,
    frames: int = 64,
    hidden: int | None = None,
) -> nn.Module:
    """Reconstruct an architecture for loading a checkpoint into.

    ``hidden`` must be threaded through from the checkpoint. It did not used to
    be, and the consequence was quiet and total: training with any non-default
    ``--hidden`` wrote a checkpoint that this function could not rebuild, so
    ``load_state_dict`` raised a size mismatch and *both* evaluate.py and
    export_onnx.py failed. The training run itself succeeded, printed its
    accuracy, and left behind a model.pt that nothing downstream could open.

    Anything that changes a layer's shape has to be recorded in the checkpoint
    and read back here. There is no way to infer it from the weights that is
    worth trusting.
    """
    if arch == "mlp":
        return FingerspellMLP(num_classes, input_dim, **_hidden(hidden))
    if arch == "gru":
        return SignGRU(num_classes, input_dim, **_hidden(hidden))
    if arch == "transformer":
        # The transformer's width is d_model rather than `hidden`; heads must
        # divide it, so it is not freely settable and is not exposed as a flag.
        return SignTransformer(num_classes, input_dim, frames=frames)
    if arch == "ctc":
        return SignCTC(num_classes, input_dim, **_hidden(hidden))
    raise ValueError(f"unknown architecture: {arch}")


def _hidden(hidden: int | None) -> dict[str, int]:
    """Pass `hidden` on only when the checkpoint recorded one.

    Checkpoints written before `hidden` was saved do not carry it, and for those
    the constructor default is the right answer — it is what they were trained
    with.
    """
    return {} if hidden is None else {"hidden": hidden}
