import { sha256 } from '@noble/hashes/sha2.js'

import { Encoding } from '@livestore/utils/effect'

/** Preserve every digest bit while staying inside the 56-character SQLite VFS filename limit. */
export const digestToFingerprint = (bytes: Uint8Array): string => Encoding.encodeBase64Url(sha256(bytes))
