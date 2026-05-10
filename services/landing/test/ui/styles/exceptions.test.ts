import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const EXCEPTIONS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../public/styles/exceptions.css',
)
const COMPOSITION_NEW = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../public/styles/composition.css',
)
const COMPOSITION_OLD = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../app/ui/layout/composition.css',
)

const css = fs.readFileSync(EXCEPTIONS_PATH, 'utf-8')

describe('exceptions.css', () => {
  it('contains the accent-top pseudo for elevated cards', () => {
    assert.match(css, /\.wf-card-elev\[data-accent-top\]::before/)
  })

  it('uses linear-gradient with --accent for the strip', () => {
    assert.match(css, /linear-gradient\(90deg[^)]*var\(--accent\)/)
  })
})

describe('composition.css move', () => {
  it('exists at public/styles/composition.css', () => {
    assert.equal(fs.existsSync(COMPOSITION_NEW), true)
  })

  it('no longer exists at app/ui/layout/composition.css', () => {
    assert.equal(fs.existsSync(COMPOSITION_OLD), false)
  })
})
