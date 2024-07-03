const textDecoder = new TextDecoder()

// From SQLites/WASM
const SECTOR_SIZE = 4096
const HEADER_MAX_PATH_SIZE = 512
const HEADER_FLAGS_SIZE = 4
const HEADER_DIGEST_SIZE = 8
const HEADER_CORPUS_SIZE = HEADER_MAX_PATH_SIZE + HEADER_FLAGS_SIZE
const HEADER_OFFSET_DIGEST = HEADER_CORPUS_SIZE
export const HEADER_OFFSET_DATA = SECTOR_SIZE

// From SQLites/WASM
const computeSAHFileDigest = (byteArray: Uint8Array) => {
  let h1 = 0xde_ad_be_ef
  let h2 = 0x41_c6_ce_57
  for (const v of byteArray) {
    h1 = 31 * h1 + v * 307
    h2 = 31 * h2 + v * 307
  }
  return new Uint32Array([h1 >>> 0, h2 >>> 0])
}

/**
 * Decodes the SAH-pool filename from the given file.
 * @returns the filename if successfully decoded, `unassociated!` if decoded but the file doesn't have an associated
 *  filename, or `undefined` if the file is not a valid SAH-pool file.
 */

export const decodeSAHPoolFilename = async (file: File) => {
  const apBody = new Uint8Array(await file.slice(0, HEADER_CORPUS_SIZE).arrayBuffer())
  const fileDigest = new Uint32Array(
    await file.slice(HEADER_OFFSET_DIGEST, HEADER_OFFSET_DIGEST + HEADER_DIGEST_SIZE).arrayBuffer(),
  )
  const compDigest = computeSAHFileDigest(apBody)
  if (fileDigest.every((v, i) => v === compDigest[i])) {
    // Valid digest
    const pathBytes = apBody.indexOf(0)
    if (pathBytes <= 0) {
      return `unassociated!`
    } else {
      return textDecoder.decode(apBody.subarray(0, pathBytes))
    }
  }
}
