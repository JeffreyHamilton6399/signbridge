import type { Settings } from './schema';
import { SETTINGS_VERSION } from './schema';

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  recognition: {
    mode: 'fingerspell',
    dominantHand: 'auto',
    twoHanded: true,
    confidenceThreshold: 0.65,
    dwellMs: 600,
    autoSpaceMs: 900,
    smoothingWindow: 5,
    wordPrediction: true,
  },
  camera: {
    deviceId: null,
    width: 1280,
    height: 720,
    targetFps: 30,
    // Mirrored by default because that is what every camera app does and what
    // people expect when they raise a hand.
    mirror: true,
    overlay: 'hands',
    framingGuide: true,
  },
  speechOut: {
    readAloud: 'word',
    voiceURI: null,
    rate: 1,
    pitch: 1,
    volume: 1,
    onlyAboveThreshold: true,
    punctuationInference: false,
  },
  speechIn: {
    deviceId: null,
    language: 'en-US',
    pushToTalk: true,
    interimResults: true,
  },
  display: {
    captionSize: 'l',
    captionPosition: 'bottom',
    font: 'display',
    theme: 'system',
    showConfidenceBar: true,
    showAlternates: true,
    reducedMotion: false,
  },
  performance: {
    backend: 'auto',
    powerSaving: false,
    precision: 'full',
  },
  privacy: {
    onDeviceOnly: true,
    saveTranscripts: false,
    autoDeleteAfterDays: 30,
  },
  accessibility: {
    hapticOnCommit: true,
    audioCueOnCommit: false,
  },
  experimental: {
    conversationMode: false,
    avatarOutput: false,
  },
  onboardingComplete: false,
};

/** Deep clone so callers cannot mutate the frozen defaults by accident. */
export function freshSettings(): Settings {
  return structuredClone(DEFAULT_SETTINGS);
}
