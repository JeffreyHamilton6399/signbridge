/// <reference lib="webworker" />
/**
 * MediaPipe landmark extraction, off the main thread.
 *
 * This exists to protect the frame budget. Landmarking is 8-20ms of work per
 * frame; on the main thread it visibly janks the video element and the commit
 * animation. The main thread grabs an ImageBitmap and hands it over; this
 * returns 21 points per hand and, optionally, 33 pose points.
 *
 * Backpressure: a frame arriving while one is in flight is dropped, not queued.
 * A queued frame produces captions that lag reality, which is worse than
 * missing a frame nobody would have noticed.
 *
 * The actual MediaPipe handling lives in landmarkerCore.ts, shared with the
 * main-thread fallback that runs when a worker cannot host it.
 */
import { Landmarker, workerCanHostVision } from './landmarkerCore';
import type { VisionInitOptions, VisionRequest, VisionResponse } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let landmarker: Landmarker | null = null;
let options: VisionInitOptions | null = null;
let busy = false;

function post(msg: VisionResponse): void {
  ctx.postMessage(msg);
}

async function build(opts: VisionInitOptions): Promise<void> {
  if (!workerCanHostVision()) {
    // The client falls back to the main thread when it sees this.
    throw new Error(
      'OffscreenCanvas is unavailable, so MediaPipe cannot run in a worker here.',
    );
  }

  landmarker?.close();
  // Explicit canvas: without it MediaPipe reaches for document.createElement on
  // Safari 16 and earlier, which does not exist in a worker. See landmarkerCore.
  landmarker = await Landmarker.create(opts, new OffscreenCanvas(1, 1), true);
  options = opts;
  post({ type: 'ready', delegate: landmarker.delegate, poseEnabled: landmarker.poseEnabled });
}

function process(bitmap: ImageBitmap, t: number): void {
  if (!landmarker || busy) {
    // Drop, do not queue.
    bitmap.close();
    return;
  }
  busy = true;
  try {
    const { frame, inferenceMs } = landmarker.detect(bitmap, t, bitmap.width, bitmap.height);
    post({ type: 'result', frame, inferenceMs });
  } catch (err) {
    post({ type: 'error', message: String(err), fatal: false });
  } finally {
    bitmap.close();
    busy = false;
  }
}

ctx.onmessage = async (event: MessageEvent<VisionRequest>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init':
        await build(msg.options);
        break;
      case 'configure': {
        if (!options) break;
        options = { ...options, ...msg.options };
        if (landmarker) {
          // In place. Rebuilding here is what produced "ModuleFactory not set"
          // on Safari when the user switched into Signs mode.
          await landmarker.update(options);
          post({
            type: 'ready',
            delegate: landmarker.delegate,
            poseEnabled: landmarker.poseEnabled,
          });
        } else {
          await build(options);
        }
        break;
      }
      case 'frame':
        process(msg.bitmap, msg.t);
        break;
      case 'dispose':
        landmarker?.close();
        landmarker = null;
        break;
    }
  } catch (err) {
    post({ type: 'error', message: String(err), fatal: true });
  }
};
