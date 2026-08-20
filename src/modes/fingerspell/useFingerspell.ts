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
import { buildPrototypes, asLetterModel, trainLinearHead } from './calibration';
import type { CalibrationSample } from './calibration';
import { loadCalibration, loadUserWords, saveUserWords, saveCalibration } from '@/db/idb';
import { handCentroid, handSpan } from '@/features/normalize';
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
}

export function useFingerspell(enabled: boolean): FingerspellApi {
  const { subscribe } = usePipeline();
  const settings = useSettings((s) => s.settings);
  const session = useSession;

  const classifier = useMemo(() => new FingerspellClassifier(), []);
  const committer = useMemo(() => new DwellCommitter(), []);
  const motion = useMemo(() => new MotionLetterDetector(), []);
  const autocompleteRef = useRef<Autocomplete>(new Autocomplete());
  const samplesRef = useRef<CalibrationSample[]>([]);
  /** Features of the most recent committed letter, for teaching from a fix. */
  const lastFeaturesRef = useRef<Float32Array | null>(null);
  const [taught, setTaught] = useState<{ letter: string; samples: number } | null>(null);
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
      classifier.setOnnxModel(null);
      samplesRef.current = [];
      return;
    }
    samplesRef.current = stored.samples;
    classifier.setPrototypes(buildPrototypes(stored.samples));
    classifier.setOnnxModel(stored.head ? asLetterModel(stored.head) : null);
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
        const event = committer.feed({ label: null, confidence: 0, t: frame.t });
        if (event.type === 'space') commitWordAndLearn();
        state.setTentative(null);
        motion.reset();
        return;
      }

      const prediction = classifier.predict(hand, aspect);
      lastFeaturesRef.current = prediction.features;

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

      const features = lastFeaturesRef.current;
      if (!features) return;

      const sample: CalibrationSample = {
        label: letter,
        features: Float32Array.from(features),
        t: Date.now(),
      };
      const samples = [...samplesRef.current, sample];
      samplesRef.current = samples;

      // Prototypes are a mean, so they update instantly and shift the decision
      // straight away. The linear head is a fit and can wait for the next
      // frame's idle moment.
      classifier.setPrototypes(buildPrototypes(samples));
      setTaught({ letter, samples: samples.filter((s) => s.label === letter).length });

      void (async () => {
        const head = samples.length >= 8 ? trainLinearHead(samples, { epochs: 150 }) : null;
        if (head) classifier.setOnnxModel(asLetterModel(head));
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
    samples: samplesRef.current,
  };
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
