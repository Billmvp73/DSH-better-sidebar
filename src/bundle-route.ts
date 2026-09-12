/**
 * Lazy chunk route: serves the client bundle's chunk scripts
 * (/sidebar/bundle/<name>.js). The official /plugins/<id>/client.js route
 * cannot serve arbitrary file names, so the plugin serves its own split
 * bundles (lib/client-<name>.js) here; the client injects the script on
 * first use of the feature that needs it (see src/client/chunk-loader.ts).
 *
 * Caching contract: every response carries `cache-control: no-cache` plus an
 * ETag (hash of the bytes served, computed per request) and honors
 * If-None-Match — the browser revalidates each fetch, but a 304 avoids
 * re-downloading multi-MB chunks that did not change (page refresh, HMR
 * re-activation). Same browser-trust fence as every other /sidebar route;
 * only allowlisted chunk names are servable (no path traversal).
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context, SidebarHttpRequest, SidebarHttpResponse } from './context-types.ts'

/** The chunk names the client may request (mirror of src/client/chunk-loader.ts). */
export const CHUNK_NAMES = ['terminal', 'editor'] as const
export type ChunkName = (typeof CHUNK_NAMES)[number]

/** Directory of this host-half module (lib/ — the chunk scripts live next to it). */
const LIB_DIR = dirname(fileURLToPath(import.meta.url))

/** sha1 content hash shortened to 12 hex chars (same shape as the client-modules rev). */
function shortHash(input: string | Buffer): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

/**
 * The chunk file's bytes with their ETag (quoted content hash), or undefined
 * when the file is missing or unreadable.
 *
 * The hash comes from the bytes this call read, never from a memo keyed on
 * `stat`: `mtime` carries at best millisecond resolution, so a rebuild emitting
 * the same byte count within one tick of the previous write leaves `mtime` and
 * `size` both unchanged and every browser holding the old ETag would 304 onto
 * the stale chunk. The 200 path had to read the file anyway; only a
 * revalidation hit pays the extra read, on a route a session touches a handful
 * of times.
 */
async function chunkOf(name: ChunkName, chunkDir: string): Promise<{ body: Buffer; etag: string } | undefined> {
  try {
    const body = await readFile(join(chunkDir, `client-${name}.js`))
    return { body, etag: `"${shortHash(body)}"` }
  } catch {
    return undefined
  }
}

/**
 * Build the /sidebar/bundle route handler. `fence` is the shared browser-
 * trust check every /sidebar route applies; `chunkDir` is the directory the
 * chunk scripts live in (overridable for tests).
 */
export function createBundleRouteHandler(
  fence: (req: SidebarHttpRequest) => boolean,
  chunkDir: string = LIB_DIR,
): (req: SidebarHttpRequest, res: SidebarHttpResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (!fence(req)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
    const match = /^\/sidebar\/bundle\/([a-z0-9-]+)\.js$/.exec(pathname)
    const name = match?.[1] as ChunkName | undefined
    if (name === undefined || !(CHUNK_NAMES as readonly string[]).includes(name)) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    const chunk = await chunkOf(name, chunkDir)
    if (chunk === undefined) {
      // Registered name but unreadable (bundle not built yet, or a read that
      // raced a rebuild): loud 404.
      res.writeHead(404)
      res.end('not found')
      return
    }
    if (req.headers['if-none-match'] === chunk.etag) {
      // Revalidation hit: unchanged chunk, no body — avoids re-downloading
      // multi-MB scripts on page refresh / HMR re-activation.
      res.writeHead(304, { 'cache-control': 'no-cache', etag: chunk.etag })
      res.end()
      return
    }
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache',
      etag: chunk.etag,
    })
    res.end(chunk.body)
  }
}

/** Register the /sidebar/bundle route (disposed with the fiber). */
export function registerBundleRoute(ctx: Context, fence: (req: SidebarHttpRequest) => boolean): () => void {
  return ctx.webServer.register({
    kind: 'prefix',
    path: '/sidebar/bundle',
    handler: createBundleRouteHandler(fence),
  })
}
