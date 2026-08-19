"""Held-out-signer splitting.

The only splitting function in this pipeline, deliberately. A random split over
clips leaks signer identity into training and inflates reported accuracy by
20-30 points on isolated-sign benchmarks: the model learns one person's version
of a sign and is then scored on more of the same person.

If you find yourself wanting ``train_test_split`` from sklearn here, that is the
bug.
"""

from __future__ import annotations

import numpy as np


def signer_split(
    signers: np.ndarray,
    holdout_fraction: float = 0.25,
    seed: int = 0,
    min_holdout: int = 1,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Split sample indices so no signer appears in both halves.

    Returns:
        (train_indices, test_indices, held_out_signer_ids)
    """
    unique = np.array(sorted(set(signers.tolist())))
    if len(unique) < 2:
        raise ValueError(
            f"Only {len(unique)} signer(s) in this dataset. A held-out-signer split is "
            "impossible, and a held-out-clip split would report a number that means nothing. "
            "Collect data from more people."
        )

    rng = np.random.default_rng(seed)
    shuffled = unique.copy()
    rng.shuffle(shuffled)

    holdout_count = max(min_holdout, int(round(len(unique) * holdout_fraction)))
    holdout_count = min(holdout_count, len(unique) - 1)
    held_out = set(shuffled[:holdout_count].tolist())

    test_mask = np.isin(signers, list(held_out))
    return np.where(~test_mask)[0], np.where(test_mask)[0], sorted(held_out)


def leave_one_signer_out(signers: np.ndarray):
    """Yield (train_idx, test_idx, signer_id) for each signer in turn.

    The most honest evaluation available on a small dataset, and the one to
    report when there are fewer than about eight signers.
    """
    for signer in sorted(set(signers.tolist())):
        test_mask = signers == signer
        yield np.where(~test_mask)[0], np.where(test_mask)[0], signer


def check_class_coverage(y: np.ndarray, indices: np.ndarray, num_classes: int) -> list[int]:
    """Classes with no examples in this split. Non-empty means the split is unusable."""
    present = set(y[indices].tolist())
    return [c for c in range(num_classes) if c not in present]
