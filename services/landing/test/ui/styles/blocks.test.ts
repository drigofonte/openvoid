import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const STYLES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../public/styles',
)
const BLOCKS_DIR = path.join(STYLES_DIR, 'blocks')
const COMPOSITIONS_DIR = path.join(STYLES_DIR, 'compositions')

// Selectors live across many files under blocks/ AND compositions/.
// For content-level assertions we read both directories and concatenate.
function readDir(dir: string): { name: string; body: string }[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .sort()
    .map((f) => ({ name: f, body: fs.readFileSync(path.join(dir, f), 'utf-8') }))
}

const blockFiles = readDir(BLOCKS_DIR)
const compositionFiles = readDir(COMPOSITIONS_DIR)
const css = [...blockFiles, ...compositionFiles].map((f) => f.body).join('\n')

describe('blocks/ + compositions/', () => {
  it('the legacy single-file blocks.css is gone', () => {
    assert.equal(fs.existsSync(path.join(STYLES_DIR, 'blocks.css')), false)
  })

  it('no block or composition file declares a :root token block (tokens belong in tokens.css)', () => {
    for (const { name, body } of [...blockFiles, ...compositionFiles]) {
      assert.doesNotMatch(body, /:root\s*\{/, `${name} must not declare :root`)
    }
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
    const composer = fs.readFileSync(path.join(COMPOSITIONS_DIR, 'composer.css'), 'utf-8')
    const composerBlock = matchBlock(composer, '.wf-composer')
    assert.match(composerBlock, /overflow:\s*hidden/)
    assert.match(composer, /\.wf-composer:focus-within/)
    assert.match(composer, /@media \(max-width:\s*720px\)/)
  })

  it('the focus-visible composite includes the new tool/go/alt/sug selectors', () => {
    const focusRing = fs.readFileSync(path.join(BLOCKS_DIR, 'focus-ring.css'), 'utf-8')
    for (const sel of ['.wf-tool', '.wf-btn-go', '.wf-alt', '.wf-sug']) {
      assert.match(focusRing, new RegExp(escapeRegex(sel) + ':focus-visible'))
    }
  })

  it('wf-livesat fades via opacity transition gated by [data-hidden]', () => {
    const livesat = fs.readFileSync(path.join(COMPOSITIONS_DIR, 'livesat.css'), 'utf-8')
    const block = matchBlock(livesat, '.wf-livesat')
    assert.match(block, /transition:\s*opacity/)
    assert.match(livesat, /\.wf-livesat\[data-hidden\]/)
  })

  it('declares the breathe and flow keyframes', () => {
    assert.match(css, /@keyframes\s+breathe\s*\{/)
    assert.match(css, /@keyframes\s+flow\s*\{/)
  })

  it('updates wf-keycap to the canonical Tokens .kbd recipe (20px tall, --r-xs, paper-2 bg)', () => {
    const keycap = fs.readFileSync(path.join(BLOCKS_DIR, 'keycap.css'), 'utf-8')
    const block = matchBlock(keycap, '.wf-keycap')
    assert.match(block, /height:\s*20px/)
    assert.match(block, /border-radius:\s*var\(--r-xs\)/)
    assert.match(block, /background:\s*var\(--paper-2\)/)
    assert.match(block, /box-shadow:\s*inset 0 0 0 1px var\(--line\)/)
  })

  it('updates wf-btn:focus-visible to the --focus-ring halo (no 2px outline)', () => {
    const focusRing = fs.readFileSync(path.join(BLOCKS_DIR, 'focus-ring.css'), 'utf-8')
    const idx = focusRing.search(/\.wf-btn:focus-visible/)
    assert.notEqual(idx, -1)
    const block = focusRing.slice(idx).match(/\{[^}]*\}/)?.[0] ?? ''
    assert.match(block, /box-shadow:\s*var\(--focus-ring\)/)
    assert.doesNotMatch(block, /outline:\s*2px solid/)
  })

  it('compositions/ holds the 13 composition-shaped files split out from blocks/', () => {
    const expected = [
      'app-icon.css',
      'composer.css',
      'connector.css',
      'icon-mark.css',
      'livesat.css',
      'progress.css',
      'skeleton.css',
      'spinner.css',
      'split-tip.css',
      'suggestion.css',
      'surface.css',
      'toolbar.css',
      'url-row.css',
    ]
    const actual = compositionFiles.map((f) => f.name)
    assert.deepEqual(actual, expected)
  })

  it('blocks/ no longer holds files that belong in compositions/', () => {
    const blockNames = blockFiles.map((f) => f.name)
    for (const moved of [
      'app-icon.css',
      'composer.css',
      'connector.css',
      'icon-mark.css',
      'livesat.css',
      'progress.css',
      'skeleton.css',
      'spinner.css',
      'split-tip.css',
      'suggestion.css',
      'surface.css',
      'toolbar.css',
      'url-row.css',
    ]) {
      assert.equal(
        blockNames.includes(moved),
        false,
        `${moved} should have moved to compositions/`,
      )
    }
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
