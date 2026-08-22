/**
 * Landmark overlay.
 *
 * Two things here exist to keep the skeleton sitting *on* the hand rather than
 * trailing behind it.
 *
 * **It redraws on every animation frame, not on every landmark frame.**
 * Landmarks arrive at 15-30fps; the display refreshes at 60. Drawing only on
 * arrival makes the overlay visibly stutter against smooth video.
 *
 * **It extrapolates.** A landmark frame describes where the hand was when it was
 * captured, which is one inference ago — 20ms on a fast machine, 100ms+ on the
 * main-thread path. The video shows *now*. Drawing the raw positions therefore
 * paints the skeleton where the hand used to be, which reads as lag even when
 * the frame rate is fine. Extrapolating along the measured velocity closes most
 * of that gap. It is capped and damped, because extrapolation amplifies noise
 * and a skeleton that overshoots is worse than one slightly behind.
 *
 * How far ahead to predict is measured from `frame.t`, the moment the frame was
 * *captured*, not from when it arrived back here. Those differ by the whole
 * inference and transfer cost — the very lag being corrected for — so predicting
 * from arrival time leaves the skeleton permanently one inference behind the
 * hand and no amount of frame rate hides it.
 *
 * Drawn from the frame subscription rather than React state — a canvas repaint
 * at 60fps must not cost a React render.
 */
import { useEffect, useRef } from 'react';
import { usePipeline } from '@/vision/pipeline';
import { useSettings } from '@/store';
import { HAND_CONNECTIONS, POSE_UPPER_CONNECTIONS } from '@/vision/types';
import type { HandFrame, Point3, VisionFrame } from '@/vision/types';
import type { ScanQuality } from '@/features/scanQuality';

/** Never predict further ahead than this, however stale the frame is. */
const MAX_EXTRAPOLATION_MS = 120;
/**
 * Fraction of the predicted movement actually applied.
 *
 * Damping exists because extrapolation amplifies whatever noise is in the
 * velocity estimate. Since landmarks now arrive already filtered (see
 * features/smoothing.ts) that noise is much smaller, and the filter's own group
 * delay is one more thing prediction has to make up, so this runs closer to 1
 * than it used to.
 */
const EXTRAPOLATION_DAMPING = 0.9;
/** Stop trusting a frame entirely once it is this old. */
const STALE_MS = 400;

interface Snapshot {
  frame: VisionFrame;
  receivedAt: number;
}

export function LandmarkOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { subscribe } = usePipeline();
  const overlay = useSettings((s) => s.settings.camera.overlay);
  const mirror = useSettings((s) => s.settings.camera.mirror);

  const overlayRef = useRef(overlay);
  const mirrorRef = useRef(mirror);
  overlayRef.current = overlay;
  mirrorRef.current = mirror;

  const latest = useRef<Snapshot | null>(null);
  const previous = useRef<Snapshot | null>(null);

  useEffect(() => {
    return subscribe((frame) => {
      const now = performance.now();
      // Only keep the previous frame if it is recent enough to give a
      // meaningful velocity; a stale one produces wild predictions.
      if (latest.current && now - latest.current.receivedAt < STALE_MS) {
        previous.current = latest.current;
      } else {
        previous.current = null;
      }
      latest.current = { frame, receivedAt: now };
    });
  }, [subscribe]);

  useEffect(() => {
    let handle = 0;

    const render = () => {
      handle = requestAnimationFrame(render);
      const canvas = canvasRef.current;
      if (!canvas) return;

      const mode = overlayRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (mode === 'off' || !latest.current) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      const now = performance.now();
      const age = now - latest.current.receivedAt;
      if (age > STALE_MS) {
        // The pipeline has stopped delivering; clear rather than leave a ghost.
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      draw(canvas, ctx, predict(latest.current, previous.current, now), mode, mirrorRef.current);
    };

    handle = requestAnimationFrame(render);
    return () => cancelAnimationFrame(handle);
  }, []);

  if (overlay === 'off') return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 h-full w-full object-cover"
    />
  );
}

/**
 * Where the hand probably is *now*, given where it was and how it was moving.
 *
 * Hands that have no counterpart in the previous frame — a first frame, or a
 * hand that just appeared — are drawn where they were reported. A hand that
 * does have one is drawn where it is going.
 */
export function predict(
  latest: Snapshot,
  previous: Snapshot | null,
  now: number,
): VisionFrame {
  const frame = latest.frame;
  if (!previous) return frame;

  const dt = latest.frame.t - previous.frame.t;
  if (dt <= 0) return frame;

  const ahead = Math.min(now - latest.frame.t, MAX_EXTRAPOLATION_MS);
  if (ahead <= 0) return frame;
  const step = (ahead / dt) * EXTRAPOLATION_DAMPING;

  return {
    ...frame,
    hands: frame.hands.map((hand, i) => {
      // Pair by tracker id. Pairing by position in the list means a velocity
      // computed across two different hands, which flings the skeleton across
      // the frame; the previous guard against that compared handedness labels,
      // which also made the overlay stall for a frame every time a label
      // flipped. Identity is the thing actually being asked about.
      const before = matchPrevious(previous.frame.hands, hand, i);
      if (!before) return hand;
      return { ...hand, landmarks: advance(hand.landmarks, before.landmarks, step) };
    }),
    pose:
      frame.pose && previous.frame.pose
        ? advance(frame.pose, previous.frame.pose, step)
        : frame.pose,
  };
}

/**
 * The same hand in the previous frame, or undefined if it was not there.
 *
 * Falls back to matching by list position and handedness for frames that carry
 * no tracker id — fixtures and hand-built test frames.
 */
function matchPrevious(
  previous: readonly HandFrame[],
  hand: HandFrame,
  index: number,
): HandFrame | undefined {
  if (hand.id !== undefined) return previous.find((h) => h.id === hand.id);
  const positional = previous[index];
  return positional && positional.handedness === hand.handedness ? positional : undefined;
}

function advance(current: Point3[], before: Point3[], step: number): Point3[] {
  if (before.length !== current.length) return current;
  return current.map((p, i) => ({
    x: p.x + (p.x - before[i].x) * step,
    y: p.y + (p.y - before[i].y) * step,
    z: p.z,
  }));
}

function draw(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  frame: VisionFrame,
  mode: 'hands' | 'hands+pose' | 'debug',
  mirror: boolean,
): void {
  if (canvas.width !== frame.width || canvas.height !== frame.height) {
    canvas.width = frame.width;
    canvas.height = frame.height;
  }

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }

  const scaleX = canvas.width;
  const scaleY = canvas.height;

  if ((mode === 'hands+pose' || mode === 'debug') && frame.pose) {
    ctx.strokeStyle = 'rgba(122, 142, 166, 0.55)';
    ctx.lineWidth = Math.max(2, canvas.width * 0.003);
    for (const [a, b] of POSE_UPPER_CONNECTIONS) {
      const pa = frame.pose[a];
      const pb = frame.pose[b];
      if (!pa || !pb) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x * scaleX, pa.y * scaleY);
      ctx.lineTo(pb.x * scaleX, pb.y * scaleY);
      ctx.stroke();
    }
  }

  for (const hand of frame.hands) {
    const accent = hand.handedness === 'Right' ? '#f2b53c' : '#7dd3fc';

    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(2.5, canvas.width * 0.0035);
    ctx.lineCap = 'round';
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = hand.landmarks[a];
      const pb = hand.landmarks[b];
      if (!pa || !pb) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x * scaleX, pa.y * scaleY);
      ctx.lineTo(pb.x * scaleX, pb.y * scaleY);
      ctx.stroke();
    }

    ctx.fillStyle = '#0b0e14';
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1.5, canvas.width * 0.002);
    const radius = Math.max(3, canvas.width * 0.005);
    hand.landmarks.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x * scaleX, p.y * scaleY, i === 0 ? radius * 1.5 : radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    if (mode === 'debug') {
      ctx.save();
      // Undo the mirror for text so labels stay readable.
      if (mirror) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      const wrist = hand.landmarks[0];
      const x = mirror ? canvas.width - wrist.x * scaleX : wrist.x * scaleX;
      ctx.fillStyle = accent;
      ctx.font = `${Math.round(canvas.width * 0.022)}px ui-monospace, monospace`;
      ctx.fillText(
        `${hand.handedness} ${(hand.handednessScore * 100).toFixed(0)}%`,
        x + 12,
        wrist.y * scaleY + 6,
      );
      ctx.restore();
    }
  }

  ctx.restore();
}

/**
 * Framing guide - a soft rectangle showing where hands are actually tracked
 * well. Landmarks at the very edge of frame are unreliable, and the honest fix
 * is to tell people where to stand rather than silently degrading.
 */
export function FramingGuide({ scan }: { scan?: ScanQuality }) {
  // The caption was static advice nobody needed after the first ten seconds.
  // Given a live reading of the input it becomes the one thing worth saying:
  // what is currently wrong. Blocking problems are stated plainly; a merely
  // imperfect view gets the same words in a quieter register, because a hint
  // that shouts at every small imperfection is a hint people learn to ignore.
  const blocking = scan?.unusable ?? false;
  const message = scan?.advice || 'Keep hands inside the guide';

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        aria-hidden="true"
        className={`absolute inset-x-[8%] inset-y-[14%] rounded-[2rem] border border-dashed transition-colors duration-300 sm:inset-x-[12%] sm:inset-y-[8%] ${
          blocking ? 'border-[var(--color-signal)]/60' : 'border-white/18'
        }`}
      />
      {/* Below the top chrome, which on a phone is two stacked rows deep. */}
      <div className="absolute inset-x-0 top-[15%] flex justify-center sm:top-[9%] short:top-[24%]">
        <span
          // Polite, not assertive: this changes as the hand moves, and a screen
          // reader interrupting every letter to say "move closer" would be
          // worse than saying nothing.
          role="status"
          aria-live="polite"
          className={`rounded-full px-3 py-1 text-[11px] font-medium tracking-wide backdrop-blur-sm transition-colors duration-300 ${
            blocking
              ? 'bg-[var(--color-signal)]/90 text-[#1a1200]'
              : 'bg-black/45 text-white/70'
          }`}
        >
          {message}
        </span>
      </div>
    </div>
  );
}
