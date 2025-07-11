// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// This module is browser compatible.
// https://deno.land/std/encoding/base64.ts

const base64abc = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v',
  'w',
  'x',
  'y',
  'z',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '+',
  '/',
]

const textEncoder = new TextEncoder()

/**
 * CREDIT: https://gist.github.com/enepomnyaschih/72c423f727d395eeaa09697058238727
 * Encodes a given Uint8Array, ArrayBuffer or string into RFC4648 base64 representation
 * @param data
 */
export const encode = (data: Uint8Array | string): string => {
  const uint8 =
    typeof data === 'string' ? textEncoder.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data)
  let result = ''
  let i: number
  const l = uint8.length
  for (i = 2; i < l; i += 3) {
    result += base64abc[uint8[i - 2]! >> 2]
    result += base64abc[((uint8[i - 2]! & 0x03) << 4) | (uint8[i - 1]! >> 4)]
    result += base64abc[((uint8[i - 1]! & 0x0f) << 2) | (uint8[i]! >> 6)]
    result += base64abc[uint8[i]! & 0x3f]
  }
  if (i === l + 1) {
    // 1 octet yet to write
    result += base64abc[uint8[i - 2]! >> 2]
    result += base64abc[(uint8[i - 2]! & 0x03) << 4]
    result += '=='
  }
  if (i === l) {
    // 2 octets yet to write
    result += base64abc[uint8[i - 2]! >> 2]
    result += base64abc[((uint8[i - 2]! & 0x03) << 4) | (uint8[i - 1]! >> 4)]
    result += base64abc[(uint8[i - 1]! & 0x0f) << 2]
    result += '='
  }
  return result
}

/**
 * Decodes a given RFC4648 base64 encoded string
 * @param b64
 */
export const decode = (b64: string): Uint8Array => {
  const binString = atob(b64)
  const size = binString.length
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    bytes[i] = binString.charCodeAt(i)
  }
  return bytes
}

const textDecoder = new TextDecoder()
export const decodeToString = (b64: string): string => textDecoder.decode(decode(b64))
