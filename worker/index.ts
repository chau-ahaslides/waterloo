/**
 * Waterloo Worker — serves the Vue SPA (static assets) and any backend API.
 *
 * Routing (see wrangler.jsonc):
 *   - `/api/*`        → handled here (run_worker_first).
 *   - everything else → served from ./dist as a static asset, with
 *     single-page-application fallback to index.html. Those requests don't
 *     normally reach this Worker; the env.ASSETS.fetch() below is a safety net.
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      // Add real routes here. Example health check:
      if (url.pathname === "/api/health") {
        return Response.json({ ok: true, service: "waterloo" });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    // Fallback to the static asset handler.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
