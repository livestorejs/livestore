/**
 * Ensures a Uint8Array is backed by an ArrayBuffer (not SharedArrayBuffer or other ArrayBufferLike).
 * This is necessary for TypeScript 5.9+ compatibility where Uint8Array<ArrayBuffer> is required
 * for many Web APIs.
 */
export const ensureUint8ArrayBuffer = (array: Uint8Array): Uint8Array<ArrayBuffer> => {
  if (array.buffer instanceof ArrayBuffer) {
    return array as Uint8Array<ArrayBuffer>
  }
  // Copy to ensure ArrayBuffer backing if it's SharedArrayBuffer or other ArrayBufferLike
  const buffer = new ArrayBuffer(array.byteLength)
  const result = new Uint8Array(buffer)
  result.set(array)
  return result
}

/**
 * Encodes text to UTF-8 bytes backed by an ArrayBuffer.
 * Replaces the need for `textEncoder.encode(text) as Uint8Array<ArrayBuffer>` pattern.
 */
export const textEncodeToArrayBuffer = (text: string): Uint8Array<ArrayBuffer> => {
  const encoded = new TextEncoder().encode(text)
  return ensureUint8ArrayBuffer(encoded)
}

/**
 * Type guard to check if a Uint8Array is backed by an ArrayBuffer.
 */
export const isUint8ArrayBuffer = (array: Uint8Array): array is Uint8Array<ArrayBuffer> => {
  return array.buffer instanceof ArrayBuffer
}

/**
 * Converts any Uint8Array to one backed by an ArrayBuffer.
 * Safer alternative to type assertions.
 */
export const toUint8ArrayBuffer = (array: Uint8Array): Uint8Array<ArrayBuffer> => {
  if (isUint8ArrayBuffer(array)) {
    return array
  }
  // Copy to ensure ArrayBuffer backing
  const buffer = new ArrayBuffer(array.byteLength)
  const result = new Uint8Array(buffer)
  result.set(array)
  return result
}