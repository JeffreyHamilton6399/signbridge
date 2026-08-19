"""Python port of src/features/normalize.ts.

The TypeScript is the source of truth: it is what runs at inference time. This
exists so training sees exactly the same feature vectors the browser will, and
``test_parity.py`` checks that claim against fixtures.

If the two ever disagree, fix this file, not the TypeScript.
"""

from __future__ import annotations

import numpy as np

WRIST = 0
THUMB_TIP = 4
INDEX_MCP = 5
INDEX_TIP = 8
MIDDLE_MCP = 9
MIDDLE_TIP = 12
RING_TIP = 16
PINKY_MCP = 17
PINKY_TIP = 20

FINGER_CHAINS = {
    "thumb": (1, 2, 3, 4),
    "index": (5, 6, 7, 8),
    "middle": (9, 10, 11, 12),
    "ring": (13, 14, 15, 16),
    "pinky": (17, 18, 19, 20),
}

EPS = 1e-6


def hand_span(landmarks: np.ndarray) -> float:
    """Wrist to middle-MCP: the most articulation-stable segment on the hand.

    A closed fist and a flat palm give nearly the same value, which is exactly
    what a scale reference needs.
    """
    primary = float(np.linalg.norm(landmarks[MIDDLE_MCP] - landmarks[WRIST]))
    if primary > EPS:
        return primary
    across = float(np.linalg.norm(landmarks[INDEX_MCP] - landmarks[PINKY_MCP]))
    return across if across > EPS else 1.0


def normalize_hand(
    landmarks: np.ndarray,
    handedness: str = "Right",
    aspect: float = 1.0,
    mirror_left: bool = True,
    canonical_rotation: bool = True,
) -> np.ndarray:
    """Normalize one hand to canonical pose-invariant space.

    Steps, in the same order as normalize.ts:
      aspect-correct -> mirror -> translate -> scale -> rotate.

    Args:
        landmarks: (21, 3) array of image-normalized coordinates.

    Returns:
        (21, 3) array. Wrist at the origin, unit hand span, canonical roll.
    """
    pts = np.asarray(landmarks, dtype=np.float64).copy()
    if pts.shape != (21, 3):
        raise ValueError(f"expected (21, 3) landmarks, got {pts.shape}")

    # 1. aspect correction
    pts[:, 0] *= aspect
    pts[:, 2] *= aspect

    # 2. mirror left hands into right-hand space
    if mirror_left and handedness == "Left":
        pts[:, 0] *= -1

    # 3. wrist to origin
    pts -= pts[WRIST]

    # 4. unit hand span
    pts /= hand_span(pts)

    # 5. canonical roll: wrist -> middle-MCP onto +y
    if canonical_rotation:
        ref = pts[MIDDLE_MCP]
        length = float(np.hypot(ref[0], ref[1]))
        if length > EPS:
            cos = ref[1] / length
            sin = ref[0] / length
            x = pts[:, 0] * cos - pts[:, 1] * sin
            y = pts[:, 0] * sin + pts[:, 1] * cos
            pts[:, 0] = x
            pts[:, 1] = y

    return pts


def feature_vector(normalized: np.ndarray) -> np.ndarray:
    """Flatten to the 63-float vector the classifiers consume."""
    return normalized.reshape(-1).astype(np.float32)


def hand_features(
    landmarks: np.ndarray, handedness: str = "Right", aspect: float = 1.0
) -> np.ndarray:
    """Landmarks straight to a 63-float feature vector."""
    return feature_vector(normalize_hand(landmarks, handedness, aspect))


# --- sign-level windowing (mirrors src/features/window.ts) -------------------

WINDOW_FRAMES = 64
PER_FRAME_DIM = 63 + 63 + 6 + 2
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12


def body_frame(pose: np.ndarray | None, aspect: float = 1.0):
    """Shoulder-derived reference frame: origin between shoulders, scale = width."""
    if pose is None or len(pose) <= RIGHT_SHOULDER:
        return None
    left = pose[LEFT_SHOULDER]
    right = pose[RIGHT_SHOULDER]
    width = float(np.hypot((left[0] - right[0]) * aspect, left[1] - right[1]))
    if width < 1e-4:
        return None
    return ((left[0] + right[0]) / 2, (left[1] + right[1]) / 2, width)


def frame_features(
    dominant: np.ndarray | None,
    other: np.ndarray | None,
    pose: np.ndarray | None,
    aspect: float = 1.0,
    dominant_handedness: str = "Right",
    other_handedness: str = "Left",
) -> np.ndarray:
    """One frame of the sign feature vector. Layout matches window.ts exactly."""
    out = np.zeros(PER_FRAME_DIM, dtype=np.float32)
    frame = body_frame(pose, aspect)

    offset = 0
    for hand, handedness in ((dominant, dominant_handedness), (other, other_handedness)):
        if hand is not None:
            out[offset : offset + 63] = hand_features(hand, handedness, aspect)
        offset += 63

    for hand in (dominant, other):
        if hand is not None:
            wrist = hand[WRIST]
            if frame is None:
                out[offset : offset + 3] = [wrist[0] - 0.5, wrist[1] - 0.5, wrist[2]]
            else:
                ox, oy, scale = frame
                out[offset : offset + 3] = [
                    (wrist[0] - ox) / scale,
                    (wrist[1] - oy) / scale,
                    wrist[2] / scale,
                ]
        offset += 3

    out[offset] = 1.0 if dominant is not None else 0.0
    out[offset + 1] = 1.0 if other is not None else 0.0
    return out


def resample_window(frames: np.ndarray, target: int = WINDOW_FRAMES) -> np.ndarray:
    """Resample (T, D) to (target, D) with linear interpolation.

    Resampling rather than padding is what makes a sign performed quickly and
    the same sign performed slowly produce the same feature vector. Speed is a
    signer trait, not a lexical one.
    """
    frames = np.asarray(frames, dtype=np.float32)
    if frames.ndim != 2:
        raise ValueError(f"expected (T, D), got {frames.shape}")
    if len(frames) == 0:
        return np.zeros((target, PER_FRAME_DIM), dtype=np.float32)
    if len(frames) == 1:
        return np.repeat(frames, target, axis=0)

    source = np.linspace(0.0, 1.0, len(frames))
    wanted = np.linspace(0.0, 1.0, target)
    out = np.empty((target, frames.shape[1]), dtype=np.float32)
    for d in range(frames.shape[1]):
        out[:, d] = np.interp(wanted, source, frames[:, d])
    return out
