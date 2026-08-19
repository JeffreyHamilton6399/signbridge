/**
 * Inference backend selection for onnxruntime-web.
 *
 * "auto" is not just a preference order - each backend is probed, because
 * WebGPU is present-but-broken often enough (Linux, some Android drivers, some
 * VMs) that trusting `navigator.gpu` alone strands users on a black screen.
 */

import type { Backend } from '@/settings/schema';

export type ResolvedBackend = 'webgpu' | 'webgl' | 'wasm';

let configured = false;

/**
 * onnxruntime-web is ~1 MB of JS plus a 26 MB wasm binary. It is imported
 * lazily so a session that never loads an ONNX model - which is every session
 * in this build, since none ship - never pays for it.
 */
export async function ort(): Promise<typeof import('onnxruntime-web')> {
  return import('onnxruntime-web');
}

/** Point ORT at the wasm binaries Vite copies into the bundle. */
export async function configureRuntime(): Promise<void> {
  if (configured) return;
  configured = true;
  const rt = await ort();
  rt.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
  // Cross-origin isolation is required for threads; without it ORT falls back
  // to a single thread on its own, so this is a hint rather than a demand.
  rt.env.wasm.simd = true;
  rt.env.logLevel = 'error';
}

export async function probeWebGPU(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

export function probeWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export async function resolveBackend(preference: Backend): Promise<ResolvedBackend> {
  if (preference === 'webgpu') return (await probeWebGPU()) ? 'webgpu' : 'wasm';
  if (preference === 'webgl') return probeWebGL() ? 'webgl' : 'wasm';
  if (preference === 'wasm') return 'wasm';

  if (await probeWebGPU()) return 'webgpu';
  if (probeWebGL()) return 'webgl';
  return 'wasm';
}

export function executionProviders(backend: ResolvedBackend): string[] {
  // Always keep wasm as the tail provider so a failed graph partition degrades
  // instead of throwing.
  switch (backend) {
    case 'webgpu':
      return ['webgpu', 'wasm'];
    case 'webgl':
      return ['webgl', 'wasm'];
    default:
      return ['wasm'];
  }
}
