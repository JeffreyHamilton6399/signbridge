/**
 * Typed settings schema, versioned from day one.
 *
 * Every persisted blob carries `version`; `migrate()` walks it forward. Adding a
 * field means bumping SETTINGS_VERSION and adding a migration step, even when
 * the change looks backward-compatible - a user who installed the PWA six
 * months ago will hand you the old shape.
 */

export const SETTINGS_VERSION = 3;

export type Mode = 'fingerspell' | 'signs' | 'conversation' | 'reverse';
export type DominantHand = 'right' | 'left' | 'auto';
export type OverlayMode = 'off' | 'hands' | 'hands+pose' | 'debug';
export type ReadAloud = 'off' | 'letter' | 'word' | 'sentence';
export type CaptionSize = 's' | 'm' | 'l' | 'xl' | 'huge';
export type CaptionPosition = 'bottom' | 'top' | 'side';
export type FontChoice = 'display' | 'system' | 'dyslexic';
export type Theme = 'light' | 'dark' | 'contrast' | 'system';
export type Backend = 'auto' | 'webgpu' | 'webgl' | 'wasm';
export type Precision = 'full' | 'quantized';

export interface RecognitionSettings {
  mode: Mode;
  dominantHand: DominantHand;
  twoHanded: boolean;
  /** 0.3 - 0.95 */
  confidenceThreshold: number;
  /** 200 - 1500 ms */
  dwellMs: number;
  /** 400 - 2000 ms */
  autoSpaceMs: number;
  /** 1 - 15 frames */
  smoothingWindow: number;
  /** Suggest completions as letters accumulate. */
  wordPrediction: boolean;
}

export interface CameraSettings {
  deviceId: string | null;
  width: number;
  height: number;
  targetFps: number;
  mirror: boolean;
  overlay: OverlayMode;
  framingGuide: boolean;
}

export interface SpeechOutSettings {
  readAloud: ReadAloud;
  voiceURI: string | null;
  rate: number;
  pitch: number;
  volume: number;
  onlyAboveThreshold: boolean;
  punctuationInference: boolean;
}

export interface SpeechInSettings {
  deviceId: string | null;
  language: string;
  pushToTalk: boolean;
  interimResults: boolean;
}

export interface DisplaySettings {
  captionSize: CaptionSize;
  captionPosition: CaptionPosition;
  font: FontChoice;
  theme: Theme;
  showConfidenceBar: boolean;
  showAlternates: boolean;
  reducedMotion: boolean;
}

export interface PerformanceSettings {
  backend: Backend;
  powerSaving: boolean;
  precision: Precision;
}

export interface PrivacySettings {
  /** Locked on. Present in the schema so the UI can explain what it means. */
  onDeviceOnly: true;
  saveTranscripts: boolean;
  /** 0 disables auto-deletion. */
  autoDeleteAfterDays: number;
}

export interface AccessibilitySettings {
  hapticOnCommit: boolean;
  audioCueOnCommit: boolean;
}

export interface ExperimentalSettings {
  /** Phase 4 continuous recognition. Off by default, and it stays that way. */
  conversationMode: boolean;
  /** Phase 3 avatar output. Uncanny by nature; labelled as such. */
  avatarOutput: boolean;
}

export interface Settings {
  version: number;
  recognition: RecognitionSettings;
  camera: CameraSettings;
  speechOut: SpeechOutSettings;
  speechIn: SpeechInSettings;
  display: DisplaySettings;
  performance: PerformanceSettings;
  privacy: PrivacySettings;
  accessibility: AccessibilitySettings;
  experimental: ExperimentalSettings;
  /** Set once the user has seen the pre-permission explainer. */
  onboardingComplete: boolean;
}

export const CAPTION_SIZE_PX: Record<CaptionSize, number> = {
  s: 28,
  m: 40,
  l: 56,
  xl: 76,
  huge: 104,
};

export const RANGES = {
  confidenceThreshold: { min: 0.3, max: 0.95, step: 0.01 },
  dwellMs: { min: 200, max: 1500, step: 50 },
  autoSpaceMs: { min: 400, max: 2000, step: 50 },
  smoothingWindow: { min: 1, max: 15, step: 1 },
  rate: { min: 0.5, max: 2, step: 0.05 },
  pitch: { min: 0, max: 2, step: 0.05 },
  volume: { min: 0, max: 1, step: 0.05 },
  targetFps: { min: 10, max: 60, step: 5 },
  autoDeleteAfterDays: { min: 0, max: 365, step: 1 },
} as const;

export function clampToRange(key: keyof typeof RANGES, value: number): number {
  const r = RANGES[key];
  const stepped = Math.round(value / r.step) * r.step;
  return Math.min(r.max, Math.max(r.min, Number(stepped.toFixed(4))));
}
