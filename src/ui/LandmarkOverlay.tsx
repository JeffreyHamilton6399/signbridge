/**
 * Landmark overlay.
 *
 * Draws on a canvas sized to the video's intrinsic resolution and scaled by CSS,
 * so the overlay tracks the video through `object-fit: cover` cropping without
 * recomputing anything per frame.
 *
 * Drawn from the frame subscription rather than React state - a canvas repaint
 * at 30fps must not cost a React render.
 */
import { useEffect, useRef } from 'react';
import { usePipeline } from '@/vision/pipeline';
import { useSettings } from '@/store';
import { HAND_CONNECTIONS, POSE_UPPER_CONNECTIONS } from '@/vision/types';
import type { VisionFrame } from '@/vision/types';

export function LandmarkOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { subscribe } = usePipeline();
  const overlay = useSettings((s) => s.settings.camera.overlay);
  const mirror = useSettings((s) => s.settings.camera.mirror);
  const overlayRef = useRef(overlay);
  const mirrorRef = useRef(mirror);
  overlayRef.current = overlay;
  mirrorRef.current = mirror;

  useEffect(() => {
    return subscribe((frame) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const mode = overlayRef.current;
      if (mode === 'off') {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      draw(canvas, frame, mode, mirrorRef.current);
    });
  }, [subscribe]);

  if (overlay === 'off') return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 h-full w-full object-cover"
    />
  );
}

function draw(
  canvas: HTMLCanvasElement,
  frame: VisionFrame,
  mode: 'hands' | 'hands+pose' | 'debug',
  mirror: boolean,
): void {
  if (canvas.width !== frame.width || canvas.height !== frame.height) {
    canvas.width = frame.width;
    canvas.height = frame.height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

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
export function FramingGuide() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10">
      <div className="absolute inset-x-[12%] inset-y-[8%] rounded-[2rem] border border-dashed border-white/18" />
      <div className="absolute inset-x-0 top-[8%] flex justify-center">
        <span className="rounded-full bg-black/45 px-3 py-1 text-[11px] font-medium tracking-wide text-white/70 backdrop-blur-sm">
          Keep hands inside the guide
        </span>
      </div>
    </div>
  );
}
