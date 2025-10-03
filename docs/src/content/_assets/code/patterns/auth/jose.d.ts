declare module 'jose' {
  export interface JWTPayload {
    readonly [key: string]: unknown
  }

  export function jwtVerify(token: string, secret: Uint8Array | ArrayBufferView): Promise<{ payload: JWTPayload }>
}
