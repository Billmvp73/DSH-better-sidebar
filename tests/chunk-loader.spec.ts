/**
 * Chunk loader tests: the lazy chunk machinery (src/client/chunk-loader.ts).
 * Pins the caching contract that makes the lazy mechanism correct:
 * - one in-flight promise per chunk (concurrent opens share it),
 * - a failed load clears the cache so the next call retries (the script
 *   re-executes and overwrites its global registry slot — assignments are
 *   idempotent, no duplicate-registration class of errors),
 * - externals resolve through the module system's seed branch (the stable,
 *   version-independent part), once per page,
 * - resetChunks drops the cache and the externals memo (HMR).
 * The production path runs against a fake module system installed through
 * {@link setChunkModuleResolver} (the `ctx.get('modules')` read the client
 * entry performs) and a stub script loader that simulates the executed chunk
 * script by assigning the plugin-owned global factory registry.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import './browser-globals.ts'
import {
  CHUNK_EXTERNALS,
  loadChunk,
  registerChunkForTests,
  resetChunks,
  setChunkModuleResolver,
  setChunkScriptLoaderForTests,
} from '../src/client/chunk-loader.ts'
import type { ChunkExports } from '../src/client/chunk-loader.ts'

/** A module system whose seed branch answers every specifier. */
function fakeModuleSystem() {
  return { import: vi.fn(async (specifier: string) => ({ seed: specifier })) }
}

type FakeModuleSystem = ReturnType<typeof fakeModuleSystem>

/** Disposer of the resolver the current test installed (cleared per test). */
let disposeResolver: (() => void) | undefined

function installModuleSystem(): FakeModuleSystem {
  const fake = fakeModuleSystem()
  disposeResolver = setChunkModuleResolver(() => fake)
  return fake
}

function removeModuleSystem(): void {
  disposeResolver?.()
  disposeResolver = undefined
}

/** The global registry the chunk scripts populate (mirror of chunk-loader). */
function registry(): Record<string, unknown> {
  return (globalThis as { __dshChunks__?: Record<string, unknown> }).__dshChunks__ ?? {}
}

/** Simulate a chunk script executing: it assigns its factory to the registry. */
function simulateScript(name: string, factory: (require: (spec: string) => unknown) => ChunkExports): void {
  const g = globalThis as { __dshChunks__?: Record<string, unknown> }
  g.__dshChunks__ = g.__dshChunks__ ?? {}
  g.__dshChunks__[name] = factory
}

beforeEach(() => {
  removeModuleSystem()
  delete (globalThis as Record<string, unknown>).__dshChunks__
  resetChunks()
  setChunkScriptLoaderForTests(null)
})

describe('test-registry path (vitest / jsdom-less environments)', () => {
  it('returns the registered chunk exports, loading once even for concurrent callers', async () => {
    let calls = 0
    registerChunkForTests('editor', async () => {
      calls += 1
      return { TextEditor: 'text-editor' }
    })
    const [a, b, c] = await Promise.all([loadChunk('editor'), loadChunk('editor'), loadChunk('editor')])
    expect(a).toEqual({ TextEditor: 'text-editor' })
    expect(b).toBe(a)
    expect(c).toBe(a)
    expect(calls).toBe(1)
    // Memoized after resolution too.
    expect(await loadChunk('editor')).toBe(a)
    expect(calls).toBe(1)
  })

  it('a failed load clears the cache so the next call retries', async () => {
    let calls = 0
    registerChunkForTests('terminal', async () => {
      calls += 1
      if (calls === 1) throw new Error('boom')
      return { TerminalView: 'terminal-view' }
    })
    await expect(loadChunk('terminal')).rejects.toThrow('boom')
    await expect(loadChunk('terminal')).resolves.toEqual({ TerminalView: 'terminal-view' })
    expect(calls).toBe(2)
  })
})

describe('production path (script injection + global registry + externals require)', () => {
  it('injects the chunk script, then materializes the factory with externals from the module table', async () => {
    const modules = installModuleSystem()
    const loaded: string[] = []
    setChunkScriptLoaderForTests(async (src) => {
      loaded.push(src)
      simulateScript('editor', (require) => ({ TextEditor: `view:${String(require('react'))}` }))
    })
    const exports = await loadChunk('editor')
    expect(loaded).toEqual(['/sidebar/bundle/editor.js'])
    expect(exports).toEqual({ TextEditor: 'view:[object Object]' })
    // Externals resolved through the module system's seed branch, once.
    expect(modules.import).toHaveBeenCalledTimes(CHUNK_EXTERNALS.length)
    // Memoized: no second script injection, no second externals resolution.
    await loadChunk('editor')
    expect(loaded).toHaveLength(1)
    expect(modules.import).toHaveBeenCalledTimes(CHUNK_EXTERNALS.length)
  })

  it('resolves the externals table once across chunks', async () => {
    const modules = installModuleSystem()
    const seen: string[] = []
    setChunkScriptLoaderForTests(async (src) => {
      seen.push(src)
      simulateScript(src.endsWith('editor.js') ? 'editor' : 'terminal', () => ({}))
    })
    await loadChunk('terminal')
    await loadChunk('editor')
    expect(seen).toEqual(['/sidebar/bundle/terminal.js', '/sidebar/bundle/editor.js'])
    expect(modules.import).toHaveBeenCalledTimes(CHUNK_EXTERNALS.length)
  })

  it('a chunk requiring an unresolvable externals spec fails loudly', async () => {
    installModuleSystem()
    setChunkScriptLoaderForTests(async () => {
      simulateScript('editor', (require) => { require('not-in-the-table'); return {} })
    })
    await expect(loadChunk('editor')).rejects.toThrow('missed the module table')
  })

  it('a script load failure rejects without materializing', async () => {
    const modules = installModuleSystem()
    setChunkScriptLoaderForTests(async () => { throw new Error('script 404') })
    await expect(loadChunk('terminal')).rejects.toThrow('script 404')
    expect(modules.import).not.toHaveBeenCalled()
    // Cache cleared: the retry re-attempts the script load.
    setChunkScriptLoaderForTests(async () => { simulateScript('terminal', () => ({ TerminalView: 'ok' })) })
    await expect(loadChunk('terminal')).resolves.toEqual({ TerminalView: 'ok' })
  })

  it('a script that ran but registered no factory fails with a clear error', async () => {
    installModuleSystem()
    setChunkScriptLoaderForTests(async () => { /* executes but assigns nothing */ })
    await expect(loadChunk('editor')).rejects.toThrow('did not register its factory')
  })

  it('a materialization failure clears the cache; the retry re-executes cleanly (idempotent slot assignment)', async () => {
    const modules = installModuleSystem()
    let calls = 0
    setChunkScriptLoaderForTests(async () => {
      calls += 1
      simulateScript('editor', () => {
        if (calls === 1) throw new Error('materialize boom')
        return { TextEditor: 'text-editor' }
      })
    })
    await expect(loadChunk('editor')).rejects.toThrow('materialize boom')
    // Retry: script re-injected, slot overwritten, materialization succeeds.
    await expect(loadChunk('editor')).resolves.toEqual({ TextEditor: 'text-editor' })
    expect(calls).toBe(2)
    expect(modules.import).toHaveBeenCalled()
  })

  it('fails loudly when no module system is installed (before touching the network)', async () => {
    const loaded: string[] = []
    setChunkScriptLoaderForTests(async (src) => { loaded.push(src) })
    await expect(loadChunk('editor')).rejects.toThrow('client module system unavailable')
    expect(loaded).toEqual([])
  })

  it('reads the module system at chunk-load time, not at resolver installation', async () => {
    // The `modules` service is provided by a sibling Loader entry, so it may
    // still be absent while this plugin activates and installs the resolver.
    let live: FakeModuleSystem | undefined
    disposeResolver = setChunkModuleResolver(() => live)
    setChunkScriptLoaderForTests(async () => { simulateScript('editor', () => ({ TextEditor: 'text-editor' })) })
    await expect(loadChunk('editor')).rejects.toThrow('client module system unavailable')
    live = fakeModuleSystem()
    await expect(loadChunk('editor')).resolves.toEqual({ TextEditor: 'text-editor' })
    expect(live.import).toHaveBeenCalledTimes(CHUNK_EXTERNALS.length)
  })

  it('a stale disposer leaves the resolver of the newer activation installed', async () => {
    // HMR order is not guaranteed: the previous fiber may dispose after the new
    // one installed its own resolver, and must not unplug it.
    const stale = setChunkModuleResolver(() => fakeModuleSystem())
    const current = installModuleSystem()
    stale()
    setChunkScriptLoaderForTests(async () => { simulateScript('editor', () => ({ TextEditor: 'text-editor' })) })
    await expect(loadChunk('editor')).resolves.toEqual({ TextEditor: 'text-editor' })
    expect(current.import).toHaveBeenCalledTimes(CHUNK_EXTERNALS.length)
  })

  it('resetChunks drops the cache and the externals memo (HMR re-activation)', async () => {
    const modules = installModuleSystem()
    let calls = 0
    setChunkScriptLoaderForTests(async () => {
      calls += 1
      simulateScript('editor', () => ({ TextEditor: 'editor-view' }))
    })
    await loadChunk('editor')
    expect(calls).toBe(1)
    expect(modules.import).toHaveBeenCalledTimes(CHUNK_EXTERNALS.length)
    resetChunks()
    // Cache dropped: the next open re-fetches and re-executes; the externals
    // memo is rebuilt (fresh module-table resolution).
    await loadChunk('editor')
    expect(calls).toBe(2)
    expect(modules.import).toHaveBeenCalledTimes(CHUNK_EXTERNALS.length * 2)
  })

  it('resetChunks is a safe no-op without a module system', () => {
    resetChunks()
    expect(() => resetChunks()).not.toThrow()
  })
})

describe('externals contract', () => {
  it('the loader resolves exactly the platform externals the chunk builds keep external', () => {
    expect(CHUNK_EXTERNALS).toEqual([
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-store',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-ui-dockkit',
    ])
  })
})
