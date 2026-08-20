/**
 * The capture pipeline, shared by every mode.
 *
 * One camera, one worker, one landmark stream. Modes subscribe to frames rather
 * than each opening their own camera, because acquiring a second video track
 * while the first is live fails on most hardware and is slow everywhere.
 *
 * Frames are delivered through a subscription rather than React state on
 * purpose: at 30fps, putting the landmark frame in state would re-render the
 * settings panel thirty times a second.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode, RefObject } from 'react';
import { VisionClient, describeVisionError } from './client';
import type { VisionMode } from './client';
import type { VisionFrame } from './types';
import { CameraError, listCameras, openCamera, stopStream, toCameraError } from '@/camera/camera';
import type { CameraDevice } from '@/camera/camera';
import { useSettings } from '@/store';
import { useSession } from '@/store';

export type FrameListener = (frame: VisionFrame, stats: { inferenceMs: number }) => void;

interface PipelineValue {
  videoRef: RefObject<HTMLVideoElement | null>;
  devices: CameraDevice[];
  active: boolean;
  starting: boolean;
  error: { message: string; remedy: string } | null;
  delegate: 'GPU' | 'CPU' | null;
  visionMode: VisionMode | null;
  fps: number;
  start(): Promise<void>;
  stop(): void;
  subscribe(listener: FrameListener): () => void;
  /** True when the current frame contains at least one hand. */
  refreshDevices(): Promise<void>;
}

const PipelineContext = createContext<PipelineValue | null>(null);

export function usePipeline(): PipelineValue {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error('usePipeline must be used inside <PipelineProvider>');
  return ctx;
}

export function PipelineProvider({ children }: { children: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const clientRef = useRef<VisionClient | null>(null);
  const listenersRef = useRef(new Set<FrameListener>());
  const frameTimesRef = useRef<number[]>([]);

  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<PipelineValue['error']>(null);
  const [delegate, setDelegate] = useState<'GPU' | 'CPU' | null>(null);
  const [visionMode, setVisionMode] = useState<VisionMode | null>(null);
  const [fps, setFps] = useState(0);

  const settings = useSettings((s) => s.settings);
  const setPipelineState = useSession((s) => s.setPipeline);
  const setStats = useSession((s) => s.setStats);

  const cameraSettings = settings.camera;
  const needsPose =
    settings.recognition.mode === 'signs' || settings.recognition.mode === 'conversation';
  const targetFps = settings.performance.powerSaving
    ? Math.max(10, Math.round(cameraSettings.targetFps / 2))
    : cameraSettings.targetFps;

  const refreshDevices = useCallback(async () => {
    setDevices(await listCameras());
  }, []);

  const stop = useCallback(() => {
    clientRef.current?.stop();
    clientRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
    setDelegate(null);
    setVisionMode(null);
    setPipelineState('idle');
  }, [setPipelineState]);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    setPipelineState('starting');
    try {
      const stream = await openCamera({
        deviceId: cameraSettings.deviceId ?? undefined,
        width: cameraSettings.width,
        height: cameraSettings.height,
        frameRate: targetFps,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error('Video element is not mounted yet.');
      video.srcObject = stream;
      await video.play();

      // Device labels are only populated once permission has been granted, so
      // this is the first point at which the picker can show real names.
      await refreshDevices();

      // A camera unplugged mid-session ends its track. Surface it as a
      // recoverable state instead of freezing on the last frame.
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          setError({
            message: 'The camera disconnected.',
            remedy: 'Plug it back in or choose another camera, then tap Retry.',
          });
          setPipelineState('error', {
            message: 'The camera disconnected.',
            remedy: 'Plug it back in or choose another camera, then tap Retry.',
          });
          stop();
        });
      });

      const client = new VisionClient({
        onFrame(frame, inferenceMs) {
          const now = performance.now();
          const times = frameTimesRef.current;
          times.push(now);
          while (times.length > 30) times.shift();
          if (times.length > 1) {
            const span = times[times.length - 1] - times[0];
            const measured = span > 0 ? ((times.length - 1) * 1000) / span : 0;
            setFps(measured);
            setStats({ fps: measured, inferenceMs, latencyMs: now - frame.t });
          }
          for (const listener of listenersRef.current) listener(frame, { inferenceMs });
        },
        onReady(resolvedDelegate, _poseEnabled, resolvedMode) {
          setDelegate(resolvedDelegate);
          setVisionMode(resolvedMode);
          setStats({ delegate: resolvedDelegate, visionMode: resolvedMode });
          setPipelineState('running');
        },
        onError(message, fatal) {
          if (fatal) {
            const payload = {
              message: describeVisionError(message),
              remedy: 'Reload the page. If it keeps failing, switch the backend to WASM in Settings > Performance.',
            };
            setError(payload);
            setPipelineState('error', payload);
          } else {
            console.warn('Vision:', message);
          }
        },
      });
      client.setTargetFps(targetFps);
      await client.start(video, {
        trackPose: needsPose,
        numHands: settings.recognition.twoHanded ? 2 : 1,
      });
      clientRef.current = client;
      setActive(true);
    } catch (err) {
      const cameraError = err instanceof CameraError ? err : toCameraError(err);
      const payload = { message: cameraError.message, remedy: cameraError.remedy };
      setError(payload);
      setPipelineState('error', payload);
      stop();
    } finally {
      setStarting(false);
    }
  }, [
    cameraSettings.deviceId,
    cameraSettings.width,
    cameraSettings.height,
    targetFps,
    needsPose,
    settings.recognition.twoHanded,
    refreshDevices,
    setPipelineState,
    setStats,
    stop,
  ]);

  // Reconfigure the worker in place when a setting changes that it cares about,
  // rather than tearing the camera down.
  useEffect(() => {
    clientRef.current?.reconfigure({
      trackPose: needsPose,
      numHands: settings.recognition.twoHanded ? 2 : 1,
    });
  }, [needsPose, settings.recognition.twoHanded]);

  useEffect(() => {
    clientRef.current?.setTargetFps(targetFps);
  }, [targetFps]);

  useEffect(() => {
    void refreshDevices();
    const handler = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', handler);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', handler);
  }, [refreshDevices]);

  useEffect(() => stop, [stop]);

  const subscribe = useCallback((listener: FrameListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const value = useMemo<PipelineValue>(
    () => ({
      videoRef,
      devices,
      active,
      starting,
      error,
      delegate,
      visionMode,
      fps,
      start,
      stop,
      subscribe,
      refreshDevices,
    }),
    [devices, active, starting, error, delegate, visionMode, fps, start, stop, subscribe, refreshDevices],
  );

  return <PipelineContext.Provider value={value}>{children}</PipelineContext.Provider>;
}
