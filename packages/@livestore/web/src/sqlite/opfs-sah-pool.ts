import * as VFS from '@livestore/wa-sqlite/src/VFS.js'

const SECTOR_SIZE = 4096
const HEADER_MAX_PATH_SIZE = 512
const HEADER_FLAGS_SIZE = 4
const HEADER_DIGEST_SIZE = 8
const HEADER_CORPUS_SIZE = HEADER_MAX_PATH_SIZE + HEADER_FLAGS_SIZE
const HEADER_OFFSET_FLAGS = HEADER_MAX_PATH_SIZE
const HEADER_OFFSET_DIGEST = HEADER_CORPUS_SIZE
export const HEADER_OFFSET_DATA = SECTOR_SIZE

const PERSISTENT_FILE_TYPES =
  VFS.SQLITE_OPEN_MAIN_DB | VFS.SQLITE_OPEN_MAIN_JOURNAL | VFS.SQLITE_OPEN_SUPER_JOURNAL | VFS.SQLITE_OPEN_WAL

const textDecoder = new TextDecoder()

export const decodeSAHPoolFilename = async (file: File): Promise<string> => {
  // Read the path and digest of the path from the file.
  const corpus = new Uint8Array(await file.slice(0, HEADER_CORPUS_SIZE).arrayBuffer())

  // Delete files not expected to be present.
  const dataView = new DataView(corpus.buffer, corpus.byteOffset)
  const flags = dataView.getUint32(HEADER_OFFSET_FLAGS)
  if (corpus[0] && (flags & VFS.SQLITE_OPEN_DELETEONCLOSE || (flags & PERSISTENT_FILE_TYPES) === 0)) {
    console.warn(`Remove file with unexpected flags ${flags.toString(16)}`)
    return ''
  }

  const fileDigest = new Uint32Array(
    await file.slice(HEADER_OFFSET_DIGEST, HEADER_OFFSET_DIGEST + HEADER_DIGEST_SIZE).arrayBuffer(),
  )

  // Verify the digest.
  const computedDigest = computeDigest(corpus)
  if (fileDigest.every((value, i) => value === computedDigest[i])) {
    // Good digest. Decode the null-terminated path string.
    const pathBytes = corpus.indexOf(0)
    if (pathBytes === 0) {
      // Note: We can't truncate the file here as File objects are read-only
      // console.warn('Unassociated file detected')
    }
    return textDecoder.decode(corpus.subarray(0, pathBytes))
  } else {
    // Bad digest. Repair this header.
    console.warn('Disassociating file with bad digest.')
    return ''
  }
}

const computeDigest = (corpus: Uint8Array): Uint32Array => {
  if (!corpus[0]) {
    // Optimization for deleted file.
    return new Uint32Array([0xfe_cc_5f_80, 0xac_ce_c0_37])
  }

  let h1 = 0xde_ad_be_ef
  let h2 = 0x41_c6_ce_57

  for (const value of corpus) {
    h1 = Math.imul(h1 ^ value, 2_654_435_761)
    h2 = Math.imul(h2 ^ value, 1_597_334_677)
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909)

  return new Uint32Array([h1 >>> 0, h2 >>> 0])
}
