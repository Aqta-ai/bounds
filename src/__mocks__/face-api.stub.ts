// Minimal stub for @vladmandic/face-api used in the Vitest (Node.js) environment.
// The real library bundles TensorFlow.js and requires browser globals that are
// unavailable in Node. Since none of the unit tests exercise face detection at
// runtime, this stub satisfies the import graph without pulling in heavy native
// dependencies.

export const nets = {
  tinyFaceDetector: {
    loadFromUri: async (_uri: string) => { /* no-op in tests */ },
  },
}

export class TinyFaceDetectorOptions {
  constructor(_opts?: { inputSize?: number; scoreThreshold?: number }) {}
}

export function detectAllFaces(_canvas: unknown, _opts?: unknown) {
  return {
    run: async () => [],
  }
}
