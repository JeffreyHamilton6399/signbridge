/**
 * The fingerspelling loop.
 *
 * Frame in, letter out:
 *   landmarks -> normalize -> classify -> smooth -> dwell -> commit -> speak
 *
 * Everything here runs per frame, so it stays out of React state except at the
 * points where the UI genuinely changes: a new tentative letter, a commit, a
 * space. Confidence and the alternates list are pushed to the store because the
 * caption and confidence bar need them, but the landmark frame never is.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePipeline } from '@/vision/pipeline';
import { useSession, useSettings } from '@/store';
import { FingerspellClassifier } from './classifier';
import { DwellCommitter } from './debouncer';
import { MotionLetterDetector } from './motion';
import { Autocomplete } from './autocomplete';
import { buildPrototypes, trainLinearHead } from './calibration';
import type { CalibrationSample } from './calibration';
import { loadCalibration, loadUserWords, saveUserWords, saveCalibration } from '@/db/idb';
import { handCentroid, handSpan } from '@/features/normalize';
import { assessScan, GOOD_SCAN, ScanQualityTracker } from '@/features/scanQuality';
import type { ScanQuality } from '@/features/scanQuality';
import { speak, speakLetter, inferPunctuation } from '@/speech/tts';
import type { HandFrame } from '@/vision/types';

export interface FingerspellApi {
  acceptSuggestion(word: string): void;
  pickAlternate(letter: string): void;
  commitSpace(): void;
  reloadCalibration(): Promise<void>;
  /** Latest calibration samples, for the debug panel's accuracy report. */
  samples: readonly CalibrationSample[];
  /** Set briefly after a correction is folded into the personal model. */
  taught: { letter: string; samples: number } | null;
  /**
   * How good a look the camera is getting, and what to do about it. Drives the
   * live hint over the video and gates commits when the input is unusable.
   */
  scan: ScanQuality;
}

export function useFingerspell(enabled: boolean): FingerspellApi {
  const { subscribe } = usePipeline();
  const settings = useSettings((s) => s.settings);
  const session = useSession;

  const classifier = useMemo(() => new FingerspellClassifier(), []);
  const committer = useMemo(() => new DwellCommitter(), []);
  const motion = useMemo(() => new MotionLetterDetector(), []);
  const scanTracker = useMemo(() => new ScanQualityTracker(), []);
  const autocompleteRef = useRef<Autocomplete>(new Autocomplete());
  const samplesRef = useRef<CalibrationSample[]>([]);
  /**
   * Recent per-frame feature vectors, newest last.
   *
   * Long enough to cover the longest dwell setting at a low frame rate, so the
   * whole hold that produced a letter is still in here when it commits.
   */
  const recentRef = useRef<Float32Array[]>([]);
  /**
   * Features of the frames that actually produced the last committed letter.
   *
   * This used to be a single ref overwritten every frame, which meant a
   * correction filed whatever the hand happened to be doing *when the user
   * tapped* — typically a second or two later, halfway into the next letter or
   * on the way back down to rest. So the mechanism billed as the real fix for
   * the fist cluster was quietly training on mislabelled samples, which is
   * worse than training on nothing: it drags the prototype for the corrected
   * letter toward a pose that is not that letter.
   */
  const committedFeaturesRef = useRef<Float32Array[]>([]);
  const [taught, setTaught] = useState<{ letter: string; samples: number } | null>(null);
  const [scan, setScanState] = useState<ScanQuality>(GOOD_SCAN);
  // Written every frame, read only when it changes: a hint that re-rendered at
  // 30fps would cost more than it is worth.
  const scanRef = useRef<ScanQuality>(GOOD_SCAN);
  const setScan = useCallback((next: ScanQuality) => {
    if (next.problem === scanRef.current.problem) return;
    scanRef.current = next;
    setScanState(next);
  }, []);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Keep the committer in sync with settings without re-subscribing the frame
  // listener, which would tear down and rebuild the loop on every slider drag.
  useEffect(() => {
    committer.update({
      confidenceThreshold: settings.recognition.confidenceThreshold,
      dwellMs: settings.recognition.dwellMs,
      autoSpaceMs: settings.recognition.autoSpaceMs,
      smoothingWindow: settings.recognition.smoothingWindow,
    });
  }, [
    committer,
    settings.recognition.confidenceThreshold,
    settings.recognition.dwellMs,
    settings.recognition.autoSpaceMs,
    settings.recognition.smoothingWindow,
  ]);

  const reloadCalibration = useCallback(async () => {
    const stored = await loadCalibration();
    if (!stored) {
      classifier.setPrototypes(null);
      classifier.setLocalHead(null);
      samplesRef.current = [];
      return;
    }
    samplesRef.current = stored.samples;
    classifier.setPrototypes(buildPrototypes(stored.samples));
    classifier.setLocalHead(stored.head ?? null);
  }, [classifier]);

  useEffect(() => {
    void reloadCalibration();
    void loadUserWords().then((words) => {
      autocompleteRef.current = new Autocomplete(words);
    });
  }, [reloadCalibration]);

  const speakOut = useCallback((text: string, confidence: number, letter: boolean) => {
    const { speechOut, recognition } = settingsRef.current;
    if (speechOut.readAloud === 'off') return;
    if (letter && speechOut.readAloud !== 'letter') return;
    if (!letter && speechOut.readAloud === 'letter') return;
    if (speechOut.onlyAboveThreshold && confidence < recognition.confidenceThreshold) return;

    const options = {
      voiceURI: speechOut.voiceURI,
      rate: speechOut.rate,
      pitch: speechOut.pitch,
      volume: speechOut.volume,
    };
    if (letter) speakLetter(text, options);
    else speak(speechOut.punctuationInference ? inferPunctuation(text) : text, options);
  }, []);

  const commitWordAndLearn = useCallback(
    (word?: string) => {
      const state = session.getState();
      const text = (word ?? state.buffer).trim();
      if (!text) return;
      autocompleteRef.current.learn(text);
      void saveUserWords(autocompleteRef.current.export());
      state.commitWord(word);
      speakOut(text, 1, false);

      if (settingsRef.current.speechOut.readAloud === 'sentence') {
        // A sentence is read when four or more words have accumulated; there is
        // no reliable sentence boundary in fingerspelled input.
        const tokens = session.getState().tokens;
        if (tokens.length >= 4 && tokens.length % 4 === 0) {
          speakOut(tokens.slice(-4).map((t) => t.text).join(' '), 1, false);
        }
      }
    },
    [session, speakOut],
  );

  useEffect(() => {
    if (!enabled) return;

    return subscribe((frame) => {
      const state = session.getState();
      const { recognition, accessibility } = settingsRef.current;
      const aspect = frame.height > 0 ? frame.width / frame.height : 1;

      const hand = pickHand(frame.hands, recognition.dominantHand);
      if (!hand) {
        scanTracker.update(undefined, frame.t);
        setScan(assessScan({ hand: undefined, frame, speed: 0, palmFacing: 0 }));
        // Nothing to remember. Keeping the old frames would let the next
        // letter's commit snapshot a hold that belonged to the previous one.
        recentRef.current = [];
        const event = committer.feed({ label: null, confidence: 0, t: frame.t });
        if (event.type === 'space') commitWordAndLearn();
        state.setTentative(null);
        motion.reset();
        return;
      }

      const prediction = classifier.predict(hand, aspect);

      /**
       * Is the camera getting a good enough look for a letter to mean anything?
       *
       * The classifier will happily label a hand that is half out of frame or
       * ten feet away, because it never sees the frame — only 63 numbers, which
       * are just as confidently wrong as they are confidently right. When the
       * input is that poor the honest move is to stop producing letters and say
       * why, so the loop below feeds the committer a null label rather than a
       * guess. It never works the other way: nothing here can raise a
       * confidence or force a commit.
       */
      const scan = assessScan({
        hand,
        frame,
        speed: scanTracker.update(hand, frame.t),
        palmFacing: prediction.geometry.palmFacing,
      });
      setScan(scan);

      // Only frames the camera got a real look at are worth remembering: a
      // correction files these as training data, and a hand half out of shot
      // is not an example of any letter.
      recentRef.current.push(prediction.features);
      if (recentRef.current.length > RECENT_FRAMES) recentRef.current.shift();

      if (scan.unusable) {
        // Withhold. The hand is still there, so no auto-space — it has not been
        // put down, we just cannot read it — but nothing gets committed and the
        // motion buffer is dropped rather than accumulating a trajectory built
        // from landmarks half of which are extrapolated off the frame edge.
        committer.feed({ label: null, confidence: 0, handY: handCentroid(hand.landmarks).y, t: frame.t });
        recentRef.current.pop();
        motion.reset();
        state.setTentative(null);
        state.setAlternates([], {});
        return;
      }

      // Motion letters run alongside the static head and pre-empt it, because a
      // J held still is an I and would otherwise commit as one.
      motion.push(hand.landmarks, handSpan(hand.landmarks), frame.t);
      const motionHit = motion.detect(prediction.distribution, frame.t);
      if (motionHit) {
        state.appendLetter(motionHit.letter, motionHit.confidence);
        speakOut(motionHit.letter, motionHit.confidence, true);
        buzz(accessibility.hapticOnCommit);
        updateSuggestions();
        return;
      }

      state.setAlternates(prediction.alternates, prediction.distribution);

      const centroid = handCentroid(hand.landmarks);
      const event = committer.feed({
        label: prediction.label,
        confidence: prediction.confidence,
        // Hand the committer the whole distribution, not just the winner: it
        // averages across the smoothing window instead of voting, which is what
        // keeps the near-tie letters from flickering. See debouncer.ts.
        distribution: prediction.distribution,
        handY: centroid.y,
        t: frame.t,
      });

      switch (event.type) {
        case 'tracking':
          state.setTentative({
            label: event.label,
            confidence: event.confidence,
            progress: event.progress,
          });
          break;
        case 'commit':
          // Freeze the hold that produced this letter, before the hand moves
          // on. If the user corrects it, these are the frames that get the new
          // label — the ones that were actually the letter they signed.
          committedFeaturesRef.current = spread(recentRef.current, TEACH_SAMPLES);
          state.appendLetter(event.label, event.confidence);
          speakOut(event.label, event.confidence, true);
          buzz(accessibility.hapticOnCommit);
          if (accessibility.audioCueOnCommit) click();
          updateSuggestions();
          break;
        case 'space':
          commitWordAndLearn();
          break;
        case 'idle':
          state.setTentative(null);
          break;
      }
    });

    function updateSuggestions() {
      const state = session.getState();
      if (!settingsRef.current.recognition.wordPrediction) {
        state.setSuggestions([]);
        return;
      }
      state.setSuggestions(
        autocompleteRef.current
          .suggest(state.buffer)
          .map((s) => ({ word: s.word, corrected: s.corrected })),
      );
    }
  }, [enabled, subscribe, session, classifier, committer, motion, commitWordAndLearn, speakOut]);

  const acceptSuggestion = useCallback(
    (word: string) => {
      commitWordAndLearn(word);
      session.getState().setSuggestions([]);
    },
    [commitWordAndLearn, session],
  );

/**
   * Correcting a letter teaches it.
   *
   * This is the only thing that reliably fixes the fist cluster. A, T, M and N
   * differ solely by where the thumb is, and when the thumb is tucked out of
   * sight MediaPipe does not measure it — it invents a plausible one, and its
   * guess tends to look like an A. No rule written over that output can recover
   * the difference.
   *
   * A personal classifier can, because it learns what MediaPipe *actually*
   * reports for this user's T and M — hallucinated thumb included. As long as
   * the output differs consistently between the two, a fitted model separates
   * them where a hand-written rule cannot. So every correction becomes a
   * labelled sample, and a handful of them is usually enough.
   */
  const pickAlternate = useCallback(
    (letter: string) => {
      const state = session.getState();
      // Replace the last buffered letter rather than appending: the user is
      // saying "you got that one wrong", not "add another".
      if (state.buffer.length > 0) state.backspace();
      state.appendLetter(letter, 1);
      committer.reset();

      const captured = committedFeaturesRef.current;
      if (captured.length === 0) return;
      // Spent: one hold teaches once. Tapping a second alternate corrects the
      // correction, and filing the same frames under two different letters
      // would teach the model that they are both.
      committedFeaturesRef.current = [];

      const now = Date.now();
      const samples = [
        ...samplesRef.current,
        ...captured.map<CalibrationSample>((features) => ({
          label: letter,
          features: Float32Array.from(features),
          t: now,
        })),
      ];
      samplesRef.current = samples;

      // Prototypes are a mean, so they update instantly and shift the decision
      // straight away. The linear head is a fit and can wait for the next
      // frame's idle moment.
      classifier.setPrototypes(buildPrototypes(samples));
      setTaught({ letter, samples: samples.filter((s) => s.label === letter).length });

      void (async () => {
        const head = samples.length >= 8 ? trainLinearHead(samples, { epochs: 150 }) : null;
        if (head) classifier.setLocalHead(head);
        await saveCalibration(samples, head);
      })();
    },
    [session, committer, classifier],
  );

  useEffect(() => {
    if (!taught) return;
    const handle = setTimeout(() => setTaught(null), 3500);
    return () => clearTimeout(handle);
  }, [taught]);

  const commitSpace = useCallback(() => {
    commitWordAndLearn();
    committer.reset();
  }, [commitWordAndLearn, committer]);

  return {
    acceptSuggestion,
    pickAlternate,
    commitSpace,
    reloadCalibration,
    taught,
    scan,
    samples: samplesRef.current,
  };
}

/**
 * Frames of feature history kept. 1500ms is the longest dwell the settings
 * allow; at 30fps that is 45 frames, and a little headroom costs 63 floats each.
 */
const RECENT_FRAMES = 50;

/**
 * Samples filed per correction.
 *
 * More than one, because a hold lasts hundreds of milliseconds and every frame
 * of it is an example of the letter the user actually signed. Not all of them:
 * consecutive frames of a held hand are nearly identical, and forty copies of
 * one pose would swamp a calibration set collected properly.
 */
const TEACH_SAMPLES = 3;

/** Evenly spaced picks from a list, oldest first. Returns fewer if it must. */
export function spread<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    out.push(items[Math.round((i * (items.length - 1)) / (count - 1))]);
  }
  return out;
}

/** Choose which hand to read, honouring the dominant-hand preference. */
export function pickHand(
  hands: readonly HandFrame[],
  dominant: 'right' | 'left' | 'auto',
): HandFrame | undefined {
  if (hands.length === 0) return undefined;
  if (dominant === 'auto') {
    // Highest handedness confidence wins; with one hand in frame this is it.
    return [...hands].sort((a, b) => b.handednessScore - a.handednessScore)[0];
  }
  const wanted = dominant === 'right' ? 'Right' : 'Left';
  return hands.find((h) => h.handedness === wanted) ?? hands[0];
}

function buzz(enabled: boolean): void {
  if (enabled && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate?.(12);
  }
}

let audioContext: AudioContext | null = null;

/** A short, quiet click on commit. Deliberately not a notification chime. */
function click(): void {
  try {
    audioContext ??= new AudioContext();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, audioContext.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.06);
    osc.connect(gain).connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.07);
  } catch {
    // Audio is a nicety; never let it break recognition.
  }
}
