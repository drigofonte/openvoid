import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const BLOCKS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../public/styles/blocks.css',
)
const THEME_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../public/styles/theme.css',
)

const css = fs.readFileSync(BLOCKS_PATH, 'utf-8')

describe('blocks.css', () => {
  it('does not declare a :root token block (tokens belong in tokens.css)', () => {
    assert.doesNotMatch(css, /:root\s*\{/)
  })

  it('contains the existing wf-* component rules', () => {
    for (const sel of [
      '.wf-card',
      '.wf-btn',
      '.wf-chip',
      '.wf-keycap',
      '.wf-toolbar',
      '.wf-eyebrow',
      '.wf-mono',
      '.wf-link',
    ]) {
      assert.match(css, new RegExp(escapeRegex(sel) + '\\s*[,{]'))
    }
  })

  it('contains the new component recipes the redesign introduces', () => {
    for (const sel of [
      '.wf-toolbar-tall',
      '.wf-card-elev',
      '.wf-btn-action',
      '.wf-btn-action-pri',
      '.wf-btn-action-sec',
      '.wf-pill-live',
      '.wf-pill-ready',
      '.wf-pill-dot',
      '.wf-icon-mark',
      '.wf-icon-mark-dark',
      '.wf-icon-mark-line',
      '.wf-url-row',
      '.wf-url-scheme',
      '.wf-url-rest',
      '.wf-url-trail',
      '.wf-split-tip',
      '.wf-split-icon',
      '.wf-split-text',
      '.wf-connector-host',
      '.wf-connector',
      '.wf-connector-flow',
      '.wf-composer',
      '.wf-composer-bar',
      '.wf-tool',
      '.wf-btn-go',
      '.wf-alt',
      '.wf-sug',
      '.wf-livesat',
    ]) {
      assert.match(css, new RegExp(escapeRegex(sel) + '\\s*[,{]'))
    }
  })

  it('wires the composer focus-within halo and the narrow-viewport bar wrap', () => {
    const composerBlock = matchBlock(css, '.wf-composer')
    assert.match(composerBlock, /overflow:\s*hidden/)
    assert.match(css, /\.wf-composer:focus-within/)
    assert.match(css, /@media \(max-width:\s*720px\)/)
  })

  it('the focus-visible composite includes the new tool/go/alt/sug selectors', () => {
    const focusBlock = css.slice(css.search(/\.wf-btn:focus-visible/))
    const closing = focusBlock.indexOf('}')
    const composite = focusBlock.slice(0, closing)
    for (const sel of ['.wf-tool', '.wf-btn-go', '.wf-alt', '.wf-sug']) {
      assert.match(composite, new RegExp(escapeRegex(sel) + ':focus-visible'))
    }
  })

  it('wf-livesat fades via opacity transition gated by [data-hidden]', () => {
    const block = matchBlock(css, '.wf-livesat')
    assert.match(block, /transition:\s*opacity/)
    assert.match(css, /\.wf-livesat\[data-hidden\]/)
  })

  it('declares the breathe and flow keyframes', () => {
    assert.match(css, /@keyframes\s+breathe\s*\{/)
    assert.match(css, /@keyframes\s+flow\s*\{/)
  })

  it('updates wf-keycap to the canonical Tokens .kbd recipe (20px tall, --r-xs, paper-2 bg)', () => {
    const block = matchBlock(css, '.wf-keycap')
    assert.match(block, /height:\s*20px/)
    assert.match(block, /border-radius:\s*var\(--r-xs\)/)
    assert.match(block, /background:\s*var\(--paper-2\)/)
    assert.match(block, /box-shadow:\s*inset 0 0 0 1px var\(--line\)/)
  })

  it('updates wf-btn:focus-visible to the --focus-ring halo (no 2px outline)', () => {
    // Find the focus-visible rule covering wf-btn and assert it
    // uses the box-shadow halo, not the literal 2px outline.
    const idx = css.search(/\.wf-btn:focus-visible[^{]*\{[^}]*\}/)
    assert.notEqual(idx, -1)
    const block = css.slice(idx).match(/\{[^}]*\}/)?.[0] ?? ''
    assert.match(block, /box-shadow:\s*var\(--focus-ring\)/)
    assert.doesNotMatch(block, /outline:\s*2px solid/)
  })
})

describe('theme.css removal', () => {
  it('theme.css is no longer present (renamed to blocks.css)', () => {
    assert.equal(fs.existsSync(THEME_PATH), false)
  })
})

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchBlock(source: string, selector: string): string {
  const start = source.indexOf(selector)
  assert.notEqual(start, -1, `expected to find ${selector}`)
  const open = source.indexOf('{', start)
  const close = source.indexOf('}', open)
  return source.slice(open, close + 1)
}
