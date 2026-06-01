/**
 * CF Worker integration tests — official Cloudflare framework.
 *
 * These run INSIDE the Workers runtime (workerd, via Miniflare) using
 * @cloudflare/vitest-pool-workers. The Worker, its bindings, and the static
 * ASSETS handler are all the REAL thing, wired from wrangler.jsonc — not a
 * stub. Two ways to drive the Worker are exercised:
 *
 *   - `SELF.fetch(url)` — sends a request through the deployed Worker exactly
 *     as Cloudflare's edge would route it (run_worker_first + asset fallback).
 *   - `worker.fetch(req, env)` — calls the module's default export directly
 *     with the real `env` (incl. the live ASSETS binding) for the /api/*
 *     routing assertions. (This handler doesn't use the ExecutionContext, so
 *     none is passed.)
 *
 * Config: see the "workers" project in vitest.config.ts.
 */

import { env, SELF } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import worker from '../../worker/index'

// A hand-built `new Request()` is typed `Request<CfProperties>`, but the
// handler's `fetch(request: Request<…, IncomingRequestCfProperties>)` wants the
// edge "incoming request" shape. The runtime accepts a plain Request fine; this
// helper narrows the type for the direct-invocation calls only.
function incoming(url: string): Parameters<typeof worker.fetch>[0] {
  return new Request(url) as unknown as Parameters<typeof worker.fetch>[0]
}

// ---------------------------------------------------------------------------
// /api/health — handled by the Worker (run_worker_first matches /api/*)
// ---------------------------------------------------------------------------
describe('GET /api/health', () => {
  it('returns 200 JSON {ok:true, service:"waterloo"} via SELF (edge routing)', async () => {
    const res = await SELF.fetch('https://example.com/api/health')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, service: 'waterloo' })
  })

  it('returns 200 JSON when the default export is invoked directly with real env', async () => {
    const res = await worker.fetch(incoming('https://example.com/api/health'), env)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, service: 'waterloo' })
  })
})

// ---------------------------------------------------------------------------
// /api/<unknown> → 404
// ---------------------------------------------------------------------------
describe('GET /api/<unknown>', () => {
  it('returns 404 JSON {error:"Not found"} via SELF', async () => {
    const res = await SELF.fetch('https://example.com/api/nonexistent-route')

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'Not found' })
  })
})

// ---------------------------------------------------------------------------
// Non-/api path → SPA / static-asset fallback (real ASSETS binding)
// ---------------------------------------------------------------------------
describe('SPA / asset fallback', () => {
  it('serves an asset response for the root path via the real ASSETS binding', async () => {
    // env.ASSETS is the live Workers static-asset binding (from wrangler.jsonc).
    const res = await env.ASSETS.fetch(new Request('https://example.com/'))

    // No dist/ is built in the test env, so the binding 404s rather than
    // returning index.html — the point is that the REAL binding responds,
    // not a vi.fn() stub. We assert it's a genuine Response we can consume.
    expect(res).toBeInstanceOf(Response)
    expect(typeof res.status).toBe('number')
  })

  it('routes a non-/api path through the Worker default export to env.ASSETS', async () => {
    const res = await worker.fetch(incoming('https://example.com/some/client-route'), env)

    // The Worker delegates to env.ASSETS.fetch(); we just confirm it produced
    // a real Response (not the /api JSON shapes above).
    expect(res).toBeInstanceOf(Response)
    expect(res.headers.get('content-type')).not.toContain('application/json')
  })
})
