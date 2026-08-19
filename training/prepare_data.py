"""Landmark a directory of labelled media into a feature .npz.

Input layout (the signer_id level is not optional — it is what makes a
held-out-signer split possible):

    data/<task>/<signer_id>/<LABEL>/*.jpg|*.png|*.mp4

Output .npz:
    X          (N, 63) for fingerspell, (N, 64, 134) for signs
    y          (N,) int label indices
    labels     (K,) label strings
    signers    (N,) signer id per sample
    meta       json blob: source paths, extraction settings, timestamp

Usage:
    python prepare_data.py --input data/fingerspell --task fingerspell --out data/fs.npz
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from tqdm import tqdm

from normalize import PER_FRAME_DIM, WINDOW_FRAMES, hand_features, frame_features, resample_window

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
VIDEO_SUFFIXES = {".mp4", ".mov", ".webm", ".avi"}


def build_hand_landmarker(model_path: str, num_hands: int, video: bool):
    """MediaPipe Tasks hand landmarker, matching the browser's configuration."""
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    options = vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.VIDEO if video else vision.RunningMode.IMAGE,
        num_hands=num_hands,
        min_hand_detection_confidence=0.5,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    return vision.HandLandmarker.create_from_options(options), mp


def build_pose_landmarker(model_path: str, video: bool):
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.VIDEO if video else vision.RunningMode.IMAGE,
        num_poses=1,
        output_segmentation_masks=False,
    )
    return vision.PoseLandmarker.create_from_options(options)


def to_array(landmarks) -> np.ndarray:
    return np.array([[p.x, p.y, p.z] for p in landmarks], dtype=np.float64)


def handedness_of(result, index: int) -> str:
    try:
        return result.handedness[index][0].category_name
    except (AttributeError, IndexError):
        return "Right"


def iter_samples(root: Path):
    """Yield (signer_id, label, path) for every media file under root."""
    for signer_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        for label_dir in sorted(p for p in signer_dir.iterdir() if p.is_dir()):
            for path in sorted(label_dir.iterdir()):
                if path.suffix.lower() in IMAGE_SUFFIXES | VIDEO_SUFFIXES:
                    yield signer_dir.name, label_dir.name, path


def extract_fingerspell(path: Path, landmarker, mp, aspect: float) -> np.ndarray | None:
    """One 63-float vector per file. Videos contribute their middle frame."""
    import cv2

    if path.suffix.lower() in IMAGE_SUFFIXES:
        image = cv2.imread(str(path))
        if image is None:
            return None
        frames = [image]
    else:
        capture = cv2.VideoCapture(str(path))
        total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        capture.set(cv2.CAP_PROP_POS_FRAMES, max(0, total // 2))
        ok, image = capture.read()
        capture.release()
        if not ok:
            return None
        frames = [image]

    import cv2 as _cv2

    rgb = _cv2.cvtColor(frames[0], _cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = landmarker.detect(mp_image)
    if not result.hand_landmarks:
        return None
    return hand_features(to_array(result.hand_landmarks[0]), handedness_of(result, 0), aspect)


def extract_sign_window(
    path: Path, hand_landmarker, pose_landmarker, mp, dominant: str
) -> np.ndarray | None:
    """One (64, 134) window per clip."""
    import cv2

    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        return None

    per_frame: list[np.ndarray] = []
    timestamp = 0
    while True:
        ok, image = capture.read()
        if not ok:
            break
        height, width = image.shape[:2]
        aspect = width / height if height else 1.0
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        hands = hand_landmarker.detect_for_video(mp_image, timestamp)
        pose = pose_landmarker.detect_for_video(mp_image, timestamp) if pose_landmarker else None
        timestamp += 33

        dominant_hand = None
        other_hand = None
        for i, landmarks in enumerate(hands.hand_landmarks):
            array = to_array(landmarks)
            if handedness_of(hands, i) == dominant and dominant_hand is None:
                dominant_hand = array
            else:
                other_hand = array
        if dominant_hand is None and other_hand is not None:
            dominant_hand, other_hand = other_hand, None

        pose_array = (
            to_array(pose.pose_landmarks[0]) if pose and pose.pose_landmarks else None
        )
        per_frame.append(
            frame_features(dominant_hand, other_hand, pose_array, aspect, dominant)
        )

    capture.release()
    if len(per_frame) < 6:
        return None
    return resample_window(np.stack(per_frame))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--task", choices=["fingerspell", "signs"], required=True)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument(
        "--hand-model",
        default="../public/mediapipe/models/hand_landmarker.task",
        help="Same .task file the browser uses, so extraction matches.",
    )
    parser.add_argument(
        "--pose-model", default="../public/mediapipe/models/pose_landmarker_lite.task"
    )
    parser.add_argument("--dominant", default="Right", choices=["Right", "Left"])
    args = parser.parse_args()

    is_signs = args.task == "signs"
    hand_landmarker, mp = build_hand_landmarker(args.hand_model, 2 if is_signs else 1, is_signs)
    pose_landmarker = build_pose_landmarker(args.pose_model, True) if is_signs else None

    features: list[np.ndarray] = []
    labels: list[str] = []
    signers: list[str] = []
    skipped = 0

    samples = list(iter_samples(args.input))
    if not samples:
        raise SystemExit(f"No media found under {args.input}. Check the directory layout.")

    for signer, label, path in tqdm(samples, desc="landmarking"):
        if is_signs:
            vector = extract_sign_window(path, hand_landmarker, pose_landmarker, mp, args.dominant)
        else:
            vector = extract_fingerspell(path, hand_landmarker, mp, 1.0)
        if vector is None:
            skipped += 1
            continue
        features.append(vector)
        labels.append(label)
        signers.append(signer)

    if not features:
        raise SystemExit("Nothing was landmarked. Every file failed hand detection.")

    label_names = sorted(set(labels))
    label_index = {name: i for i, name in enumerate(label_names)}

    X = np.stack(features)
    y = np.array([label_index[name] for name in labels], dtype=np.int64)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.out,
        X=X,
        y=y,
        labels=np.array(label_names),
        signers=np.array(signers),
        meta=json.dumps(
            {
                "task": args.task,
                "input": str(args.input),
                "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "hand_model": args.hand_model,
                "dominant": args.dominant,
                "window_frames": WINDOW_FRAMES if is_signs else 1,
                "per_frame_dim": PER_FRAME_DIM if is_signs else 63,
                "skipped": skipped,
            }
        ),
    )

    print(f"\nWrote {args.out}")
    print(f"  samples : {len(X)}  ({skipped} skipped — no hand detected)")
    print(f"  classes : {len(label_names)}")
    print(f"  signers : {len(set(signers))}")
    if len(set(signers)) < 3:
        print(
            "\n  WARNING: fewer than three signers. A held-out-signer split needs at least\n"
            "  three to mean anything, and accuracy from fewer will not generalise."
        )


if __name__ == "__main__":
    main()
