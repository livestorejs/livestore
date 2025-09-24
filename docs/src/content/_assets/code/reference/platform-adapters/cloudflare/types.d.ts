/// <reference types="@cloudflare/workers-types" />

declare module 'cloudflare:workers' {
  export type DurableObjectState = import('@cloudflare/workers-types').DurableObjectState
  export type DurableObjectStub<T = unknown> = import('@cloudflare/workers-types').DurableObjectStub<T>
  export type DurableObjectNamespace<T = unknown> = import('@cloudflare/workers-types').DurableObjectNamespace<T>
  export type ExecutionContext = import('@cloudflare/workers-types').ExecutionContext
  export type Request = import('@cloudflare/workers-types').Request
  export type Response = import('@cloudflare/workers-types').Response
  export type HeadersInit = import('@cloudflare/workers-types').HeadersInit

  export abstract class DurableObject<TEnv = unknown> {
    protected ctx: DurableObjectState
    protected env: TEnv
    constructor(state: DurableObjectState, env: TEnv)
    fetch?(request: Request): Response | Promise<Response>
    alarm?(info?: { isRetry: boolean; retryCount: number }): void | Promise<void>
  }
}
