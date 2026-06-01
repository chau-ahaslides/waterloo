// @vitest-environment node
/**
 * CF Worker integration tests — exercises worker/index.ts directly
 * by calling its fetch handler with a stubbed env.
 *
 * Approach: import the Worker default export and call `worker.fetch(req, env)`.
 * This runs the actual routing logic in Node (via Vite transform) without
 * spinning up workerd, so no build step or wrangler is required.
 *
 * The stub env provides:
 *   - ASSETS.fetch: a function that returns a mock 200 HTML response,
 *     simulating what Cloudflare's static-asset binding would do.
 */

import { describe, it, expect, vi } from 'vitest'
import worker from '../../worker/index'

/** Minimal stub for the Env the Worker expects. */
function makeEnv(assetFetch?: (req: Request) => Promise<Response>) {
  return {
    ASSETS: {
      fetch: assetFetch ?? vi.fn().mockResolvedValue(new Response('<html>SPA</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })),
    },
    FLEET_TOKEN: '',
  } as unknown as Env
}

// ---------------------------------------------------------------------------
// /api/health
// ---------------------------------------------------------------------------
describe('GET /api/health', () => {
  it('returns 200 JSON {ok:true, service:"waterloo"}', async () => {
    const req = new Request('https://example.com/api/health')
    const env = makeEnv()

    const res = await worker.fetch(req, env)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, service: 'waterloo' })
  })

  it('does NOT call env.ASSETS (api route is handled by the worker)', async () => {
    const assetFetch = vi.fn()
    const req = new Request('https://example.com/api/health')
    const env = makeEnv(assetFetch)

    await worker.fetch(req, env)

    expect(assetFetch).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// /api/<unknown> → 404
// ---------------------------------------------------------------------------
describe('GET /api/<unknown>', () => {
  it('returns 404 JSON {error:"Not found"}', async () => {
    const req = new Request('https://example.com/api/nonexistent-route')
    const env = makeEnv()

    const res = await worker.fetch(req, env)

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'Not found' })
  })
})

// ---------------------------------------------------------------------------
// Non-/api path → falls through to env.ASSETS (SPA handler)
// ---------------------------------------------------------------------------
describe('GET / (non-api path)', () => {
  it('delegates to env.ASSETS.fetch and returns its response', async () => {
    const assetFetch = vi.fn().mockResolvedValue(
      new Response('<html>SPA index</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    )
    const req = new Request('https://example.com/')
    const env = makeEnv(assetFetch)

    const res = await worker.fetch(req, env)

    expect(assetFetch).toHaveBeenCalledOnce()
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('SPA index')
  })

  it('delegates unknown client-side routes to env.ASSETS (SPA fallback)', async () => {
    const assetFetch = vi.fn().mockResolvedValue(
      new Response('<html>index</html>', { status: 200 }),
    )
    const req = new Request('https://example.com/some/client-route')
    const env = makeEnv(assetFetch)

    await worker.fetch(req, env)

    expect(assetFetch).toHaveBeenCalledWith(req)
  })
})
