import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const EXCEPTIONS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../public/styles/exceptions.css',
)
const LAYOUT_PRIMITIVES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../public/styles/layout-primitives',
)
const LEGACY_COMPOSITION_CSS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../public/styles/composition.css',
)
const LEGACY_COMPOSITION_IN_LAYOUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../app/ui/layout/composition.css',
)

const css = fs.readFileSync(EXCEPTIONS_PATH, 'utf-8')

describe('exceptions.css', () => {
  it('contains the accent-top pseudo for elevated cards', () => {
    assert.match(css, /\.card-shell\[data-accent-top\]::before/)
  })

  it('uses linear-gradient with --accent for the strip', () => {
    assert.match(css, /linear-gradient\(90deg[^)]*var\(--accent\)/)
  })
})

describe('CUBE Composition layer location', () => {
  it('lives at public/styles/layout-primitives/ (one file per primitive)', () => {
    assert.equal(fs.existsSync(LAYOUT_PRIMITIVES_DIR), true)
    const files = fs.readdirSync(LAYOUT_PRIMITIVES_DIR).filter((f) => f.endsWith('.css')).sort()
    assert.deepEqual(files, [
      'box.css',
      'center.css',
      'cluster.css',
      'cover.css',
      'flow.css',
      'frame.css',
      'grid.css',
      'reel.css',
      'sidebar.css',
      'stack.css',
      'switcher.css',
    ])
  })

  it('the legacy single-file composition.css is gone', () => {
    assert.equal(fs.existsSync(LEGACY_COMPOSITION_CSS), false)
  })

  it('no stray composition.css at app/ui/layout/composition.css', () => {
    assert.equal(fs.existsSync(LEGACY_COMPOSITION_IN_LAYOUT), false)
  })
})
