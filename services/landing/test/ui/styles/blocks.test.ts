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

  it('contains the canonical and non-canonical component rules', () => {
    for (const sel of [
      // Canonical block selectors
      '.btn-pri',
      '.btn-sec',
      '.btn-ghost',
      '.card-shell',
      '.composer',
      '.composer-bar',
      '.composer-derived',
      // Non-canonical product extensions (still wf- prefixed)
      '.wf-card',
      '.wf-keycap',
      '.wf-toolbar',
      '.wf-toolbar-tall',
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
      '.wf-alt',
      '.wf-sug',
      // Typography utilities
      '.kicker',
      '.wf-mono',
      '.wf-link',
    ]) {
      assert.match(css, new RegExp(escapeRegex(sel) + '\\s*[,{]'))
    }
  })

  it('wires the composer focus-within halo and the narrow-viewport bar wrap', () => {
    const composer = fs.readFileSync(path.join(COMPOSITIONS_DIR, 'composer.css'), 'utf-8')
    const composerBlock = matchBlock(composer, '.composer')
    assert.match(composerBlock, /overflow:\s*hidden/)
    assert.match(composer, /\.composer:focus-within/)
    assert.match(composer, /@media \(max-width:\s*720px\)/)
  })

  it('the focus-visible composite covers canonical buttons and product-extension pills', () => {
    const focusRing = fs.readFileSync(path.join(BLOCKS_DIR, 'focus-ring.css'), 'utf-8')
    for (const sel of ['.btn-pri', '.btn-sec', '.btn-ghost', '.wf-alt', '.wf-sug']) {
      assert.match(focusRing, new RegExp(escapeRegex(sel) + ':focus-visible'))
    }
  })

  it('the composer derived row fades via opacity transition gated by [data-hidden]', () => {
    const composer = fs.readFileSync(path.join(COMPOSITIONS_DIR, 'composer.css'), 'utf-8')
    const block = matchBlock(composer, '.composer-derived')
    assert.match(block, /transition:\s*opacity/)
    assert.match(composer, /\.composer-derived\[data-hidden\]/)
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

  it('the focus-ring composite uses the --focus-ring halo (no 2px outline)', () => {
    const focusRing = fs.readFileSync(path.join(BLOCKS_DIR, 'focus-ring.css'), 'utf-8')
    const idx = focusRing.search(/\.btn-pri:focus-visible/)
    assert.notEqual(idx, -1)
    const block = focusRing.slice(idx).match(/\{[^}]*\}/)?.[0] ?? ''
    assert.match(block, /box-shadow:\s*var\(--focus-ring\)/)
    assert.doesNotMatch(block, /outline:\s*2px solid/)
  })

  it('compositions/ holds only composition-shaped files', () => {
    const expected = [
      'card-shell.css',
      'composer.css',
      'connector.css',
      'split-tip.css',
      'suggestion.css',
      'toolbar.css',
      'url-row.css',
    ]
    const actual = compositionFiles.map((f) => f.name)
    assert.deepEqual(actual, expected)
  })

  it('blocks/ holds leaf display primitives including the leaves reclassified from compositions/', () => {
    const blockNames = blockFiles.map((f) => f.name)
    for (const leaf of [
      'app-icon.css',
      'icon-mark.css',
      'progress.css',
      'skeleton.css',
      'spinner.css',
      'surface.css',
    ]) {
      assert.equal(
        blockNames.includes(leaf),
        true,
        `${leaf} should live in blocks/ (leaf display primitive)`,
      )
    }
  })

  it('blocks/ does not hold composition-shaped files', () => {
    const blockNames = blockFiles.map((f) => f.name)
    for (const composition of [
      'card-shell.css',
      'composer.css',
      'connector.css',
      'split-tip.css',
      'suggestion.css',
      'toolbar.css',
      'url-row.css',
    ]) {
      assert.equal(
        blockNames.includes(composition),
        false,
        `${composition} should live in compositions/`,
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
