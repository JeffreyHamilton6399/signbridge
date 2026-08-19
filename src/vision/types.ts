/** Landmark and frame types shared by the worker, the feature pipeline and the UI. */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Which physical hand MediaPipe believes it saw, in real-world terms. */
export type Handedness = 'Left' | 'Right';

export interface HandFrame {
  /** 21 landmarks, MediaPipe hand topology, image-normalized coordinates. */
  landmarks: Point3[];
  handedness: Handedness;
  /** MediaPipe's handedness confidence, 0..1. */
  handednessScore: number;
}

export interface VisionFrame {
  /** Monotonic capture timestamp in ms (performance.now() domain). */
  t: number;
  hands: HandFrame[];
  /** 33 pose landmarks, present only when pose tracking is enabled. */
  pose: Point3[] | null;
  /** Source frame dimensions, needed to correct for non-square aspect ratios. */
  width: number;
  height: number;
}

export const HAND_LANDMARK = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/** Upper-body pose indices we keep. Legs are noise for signing. */
export const POSE_UPPER_BODY = [
  0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
] as const;

export const POSE_UPPER_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
];

/** Fingers in the order the geometry helpers report them. */
export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
export type Finger = (typeof FINGERS)[number];

export const FINGER_CHAIN: Record<Finger, readonly [number, number, number, number]> = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};
