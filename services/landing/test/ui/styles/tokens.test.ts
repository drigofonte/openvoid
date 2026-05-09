import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const TOKENS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../public/styles/tokens.css',
)
const UTOPIA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../public/styles/utopia.css',
)

const css = fs.readFileSync(TOKENS_PATH, 'utf-8')
const utopiaCss = fs.readFileSync(UTOPIA_PATH, 'utf-8')

describe('tokens.css', () => {
  it('declares the canonical OpenVoid tokens', () => {
    for (const name of [
      '--paper',
      '--paper-2',
      '--card',
      '--ink',
      '--ink-4',
      '--line',
      '--accent',
      '--accent-soft',
      '--ok',
      '--font-sans',
      '--font-mono',
      '--sp-3',
      '--sp-9',
      '--sp-12',
      '--r-xs',
      '--r-lg',
      '--r-pill',
      '--shadow-2',
      '--focus-ring',
      '--dur-breathe',
      '--ease-std',
      '--w-prose',
      '--w-stage',
      '--h-header',
    ]) {
      assert.match(css, new RegExp(`${name}\\s*:`))
    }
  })

  it('uses a custom clamp for --fs-display and aliases --fs-h1 to Utopia step-3', () => {
    assert.match(css, /--fs-display:\s*clamp\(/)
    assert.match(css, /--fs-h1:\s*var\(--step-3\)/)
  })

  it('aliases --sp-10/11/12 to Utopia space-l/xl/2xl', () => {
    assert.match(css, /--sp-10:\s*var\(--space-l\)/)
    assert.match(css, /--sp-11:\s*var\(--space-xl\)/)
    assert.match(css, /--sp-12:\s*var\(--space-2xl\)/)
  })

  it('declares every wf-* alias the existing components consume', () => {
    // Enumerate the wf-* names actually referenced in app/.
    for (const name of [
      '--wf-bg',
      '--wf-bg-alt',
      '--wf-page-bg',
      '--wf-fg',
      '--wf-fg-muted',
      '--wf-fg-faint',
      '--wf-line',
      '--wf-line-soft',
      '--wf-accent',
      '--wf-accent-soft',
      '--wf-ok',
      '--wf-ok-soft',
      '--wf-font',
      '--wf-mono',
      '--wf-warn',
      '--wf-warn-soft',
      '--wf-danger',
      '--wf-danger-soft',
    ]) {
      assert.match(css, new RegExp(`${name}\\s*:`))
    }
  })

  it('routes --wf-* aliases through canonical tokens (no literal divergence)', () => {
    // wf-fg/wf-line/wf-accent must reference their canonical
    // counterparts; if a future edit drops the indirection the
    // call sites silently fall back to default values.
    assert.match(css, /--wf-fg:\s*var\(--ink\)/)
    assert.match(css, /--wf-line:\s*var\(--line\)/)
    assert.match(css, /--wf-accent:\s*var\(--accent\)/)
  })

  it('every Utopia step that tokens.css aliases exists in utopia.css', () => {
    // Cross-file alias dependency — if utopia.css is regenerated
    // without these steps, the browser silently renders unset
    // variables.
    for (const step of ['--step-3', '--space-l', '--space-xl', '--space-2xl']) {
      assert.match(utopiaCss, new RegExp(`${step}\\s*:`))
    }
  })
})
