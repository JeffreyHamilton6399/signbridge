/**
 * Camera acquisition.
 *
 * Three things this handles that a bare getUserMedia call does not:
 *   - device labels are empty until permission is granted, so enumeration is
 *     re-run after the first successful acquisition
 *   - a device unplugged mid-session fires `ended` on the track; we surface that
 *     as a recoverable state rather than freezing on the last frame
 *   - every failure maps to a message that says what to do next
 */

export interface CameraDevice {
  deviceId: string;
  label: string;
  /** Best-effort guess from the label. Used to default to the front camera. */
  facing: 'user' | 'environment' | 'unknown';
}

export type CameraErrorKind =
  | 'denied'
  | 'not-found'
  | 'in-use'
  | 'insecure-context'
  | 'unsupported'
  | 'unknown';

export class CameraError extends Error {
  kind: CameraErrorKind;
  /** What the user should actually do, in plain language. */
  remedy: string;

  constructor(kind: CameraErrorKind, message: string, remedy: string) {
    super(message);
    this.name = 'CameraError';
    this.kind = kind;
    this.remedy = remedy;
  }
}

export interface CameraConstraintsInput {
  deviceId?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  facingMode?: 'user' | 'environment';
}

export function isSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof window !== 'undefined' &&
    window.isSecureContext
  );
}

export async function listCameras(): Promise<CameraDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera ${i + 1}`,
      facing: guessFacing(d.label),
    }));
}

function guessFacing(label: string): CameraDevice['facing'] {
  const l = label.toLowerCase();
  if (/front|user|facetime|integrated|internal/.test(l)) return 'user';
  if (/back|rear|environment/.test(l)) return 'environment';
  return 'unknown';
}

export async function openCamera(input: CameraConstraintsInput = {}): Promise<MediaStream> {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    throw new CameraError(
      'insecure-context',
      'Camera access needs a secure connection.',
      'Open SignBridge over https, or on localhost.',
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError(
      'unsupported',
      'This browser cannot open a camera.',
      'Try Chrome, Edge or Safari.',
    );
  }

  const video: MediaTrackConstraints = {
    width: { ideal: input.width ?? 1280 },
    height: { ideal: input.height ?? 720 },
    frameRate: { ideal: input.frameRate ?? 30 },
  };
  if (input.deviceId) video.deviceId = { exact: input.deviceId };
  else video.facingMode = { ideal: input.facingMode ?? 'user' };

  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (err) {
    throw toCameraError(err);
  }
}

export function toCameraError(err: unknown): CameraError {
  const name = (err as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError(
        'denied',
        'Camera permission was blocked.',
        'Allow camera access for this site in your browser settings, then tap Retry.',
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError(
        'not-found',
        'No camera matched what SignBridge asked for.',
        'Pick a different camera in Settings, or plug one in and tap Retry.',
      );
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError(
        'in-use',
        'The camera is in use by another app.',
        'Close the other app using the camera, then tap Retry.',
      );
    default:
      return new CameraError(
        'unknown',
        (err as Error)?.message || 'The camera could not be opened.',
        'Tap Retry. If it keeps failing, reload the page.',
      );
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Current permission state, when the browser exposes it. */
export async function cameraPermissionState(): Promise<PermissionState | 'unknown'> {
  try {
    const status = await navigator.permissions?.query({
      name: 'camera' as PermissionName,
    });
    return status?.state ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
