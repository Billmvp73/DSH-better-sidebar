/**
 * Skinning-contract tests — the stable anchors issue #106 asks for.
 *
 * Third-party theme/skin plugins need stable, class-name-independent hooks
 * to restyle the sidebar (the CSS module local names are hash-prefixed and
 * were historically camelCase, which case-sensitive substring selectors like
 * `[class*='panel']` cannot match). This suite mounts the REAL Sidebar shell
 * and asserts the `data-bs-*` attributes exist on the surfaces they promise:
 *
 *   data-bs-panel="right" | "bottom"   the two workbench panels
 *   data-bs-tabbar                     the tab strip
 *   data-bs-pane / data-bs-pane-card   the workbench leaf + empty-state card
 *   data-bs-browser-bar                the browser tab's address bar
 *   data-bs-corner-handle              the shared corner resize handle
 *   data-bs-resize-strip="width"|"height"  the two drag strips
 *   data-bs-toggle-cluster             the persistent expand/collapse buttons
 *
 * It also guards the corner handle's geometry contract: positioned by CSS
 * relative to the panel (no JS-written viewport coordinates), so floating
 * card skins that inset the panels keep the handle glued to the seam.
 *
 * Rendered with the REAL Sidebar shell + real store/service against a
 * minimal fake context (createRoot + act(), the repo's jsdom pattern).
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { Sidebar } from '../src/client/Sidebar.tsx'
import { createSidebarStore, toggleBottomPanel, type SidebarStore } from '../src/client/state.ts'
import { createBetterSidebarService, type BetterSidebarService } from '../src/client/service.ts'

/** jsdom has no WebSocket; the agent-terminals push effect constructs one on mount. */
class FakeWebSocket {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  close = (): void => {}
  constructor(_url: string) {}
}

interface MountedSidebar {
  container: HTMLDivElement
  store: SidebarStore
  service: BetterSidebarService
  unmount: () => void
}

/** Mount the real Sidebar shell against a minimal context (real store + service). */
function mountSidebar(): MountedSidebar {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  const container = document.createElement('div')
  document.body.append(container)
  const store = createSidebarStore()
  const service = createBetterSidebarService(store)
  // Fresh-session seed: the panel starts OPEN (openByDefault default true).
  store.setSession('s1')
  const localeSnapshot = { active: 'en' }
  const sessionsSnapshot = {
    current: 's1',
    byId: { s1: { cwd: '/tmp' } },
  }
  const ctx = {
    locale: { subscribe: () => () => {}, getSnapshot: () => localeSnapshot },
    sessions: { list: { subscribe: () => () => {}, getSnapshot: () => sessionsSnapshot } },
    betterSidebar: service,
  }
  const root: Root = createRoot(container)
  act(() => { root.render(createElement(Sidebar, { ctx: ctx as never, store })) })
  return {
    container,
    store,
    service,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('skinning hooks (data-bs-*)', () => {
  it('the right panel, resize strips and toggle cluster carry their hooks', () => {
    const { container } = mountSidebar()
    const panel = container.querySelector('[data-bs-panel="right"]')
    expect(panel).not.toBeNull()
    // The width drag strip lives inside the right panel.
    expect(panel!.querySelector('[data-bs-resize-strip="width"]')).not.toBeNull()
    // The persistent cluster is a sibling shell element, not inside a panel.
    expect(container.querySelector('[data-bs-toggle-cluster]')).not.toBeNull()
    // The seeded Explorer tab renders a tab strip and a workbench leaf.
    expect(container.querySelector('[data-bs-tabbar]')).not.toBeNull()
    expect(container.querySelector('[data-bs-pane]')).not.toBeNull()
  })

  it('the bottom panel and its chrome carry their hooks once opened', () => {
    const { container, service, store } = mountSidebar()
    // Keep the first-expansion auto terminal out of the way: the pane must
    // stay empty so its welcome cards (pane-card) render. The card inventory
    // comes from the tab registry, so register a tab first (the test env has
    // no builtins).
    store.setPrefs({ ...store.getPrefs(), bottomPanelAutoTerminal: false })
    service.registerTab({
      id: 'sample',
      title: 'Sample',
      component: () => createElement('div', null, 'sample'),
    })
    act(() => { store.reduce(toggleBottomPanel) })
    const bottom = container.querySelector('[data-bs-panel="bottom"]')
    expect(bottom).not.toBeNull()
    expect(bottom!.querySelector('[data-bs-resize-strip="height"]')).not.toBeNull()
    // The bottom pane starts empty → its welcome cards render pane cards.
    expect(bottom!.querySelector('[data-bs-pane]')).not.toBeNull()
    expect(bottom!.querySelector('[data-bs-pane-card]')).not.toBeNull()
  })

  it('the corner handle renders INSIDE the right panel with no JS coordinates', () => {
    const { container, store } = mountSidebar()
    // Both panels open → the shared corner appears.
    act(() => { store.reduce(toggleBottomPanel) })
    const panel = container.querySelector('[data-bs-panel="right"]')!
    const handle = panel.querySelector('[data-bs-corner-handle]')
    expect(handle).not.toBeNull()
    // Geometry contract (issue #106): the handle is positioned by CSS
    // relative to the panel — no inline viewport coordinates on it.
    expect(handle!.getAttribute('style')).toBeNull()
  })
})
