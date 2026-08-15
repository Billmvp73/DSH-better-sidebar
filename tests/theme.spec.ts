/**
 * Live theme-token access tests — issue #90's guard.
 *
 * `effectiveTokenValue` must treat visually inert values (`transparent`,
 * CSS keyword resets, empty) as UNSET so callers' `|| fallback` chains fire.
 * Skin plugins set global tokens like `--dsw-alias-bg-base` to
 * `transparent` (glass skins); without this guard a truthy-but-inert value
 * would leave terminals/panels see-through over the skin's backdrop.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { effectiveTokenValue, tokenValue } from '../src/client/theme.ts'

afterEach(() => {
  document.body.removeAttribute('style')
})

describe('effectiveTokenValue', () => {
  it('passes through real paint values verbatim', () => {
    document.body.style.setProperty('--probe', '#112233')
    expect(effectiveTokenValue('--probe')).toBe('#112233')
    // Translucent values are DELIBERATE surface choices (a skin's scoped
    // glass), not inert — they must pass through.
    document.body.style.setProperty('--probe', 'rgba(10, 22, 54, 0.96)')
    expect(effectiveTokenValue('--probe')).toBe('rgba(10, 22, 54, 0.96)')
  })

  it('treats transparent and CSS reset keywords as unset', () => {
    for (const inert of ['transparent', 'initial', 'inherit', 'unset']) {
      document.body.style.setProperty('--probe', inert)
      expect(effectiveTokenValue('--probe'), inert).toBe('')
    }
  })

  it('treats a missing token as unset', () => {
    expect(effectiveTokenValue('--never-defined')).toBe('')
  })

  it('tokenValue still returns the raw value', () => {
    document.body.style.setProperty('--probe', 'transparent')
    expect(tokenValue('--probe')).toBe('transparent')
    expect(effectiveTokenValue('--probe')).toBe('')
  })
})
