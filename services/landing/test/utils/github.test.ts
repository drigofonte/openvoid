import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { branchUrl } from '../../app/utils/github.ts'

describe('branchUrl', () => {
  it('builds the canonical /tree/<branch> URL', () => {
    assert.equal(
      branchUrl('https://github.com/example/x', 'main'),
      'https://github.com/example/x/tree/main',
    )
  })

  it('strips a `.git` suffix', () => {
    assert.equal(
      branchUrl('https://github.com/example/x.git', 'main'),
      'https://github.com/example/x/tree/main',
    )
  })

  it('strips trailing slashes (with or without `.git`)', () => {
    assert.equal(
      branchUrl('https://github.com/example/x/', 'main'),
      'https://github.com/example/x/tree/main',
    )
    assert.equal(
      branchUrl('https://github.com/example/x.git/', 'main'),
      'https://github.com/example/x/tree/main',
    )
  })

  it('URL-encodes branch names with slashes (e.g. `feat/<sid>`)', () => {
    assert.equal(
      branchUrl('https://github.com/example/x.git/', 'feat/01HABCDEF'),
      'https://github.com/example/x/tree/feat%2F01HABCDEF',
    )
  })

  it('strips embedded basic-auth credentials', () => {
    assert.equal(
      branchUrl('https://maria:ghp_TOKEN@github.com/example/x.git', 'main'),
      'https://github.com/example/x/tree/main',
    )
  })

  it('returns null for unparseable inputs', () => {
    assert.equal(branchUrl('not a url', 'main'), null)
    assert.equal(branchUrl('', 'main'), null)
  })

  it('returns null for non-HTTP(S) schemes (XSS guard)', () => {
    // Done banner renders branchUrl output as <a href>, so `javascript:`,
    // `data:`, `file:` and friends would be clickable XSS vectors.
    assert.equal(branchUrl('javascript:alert(1)', 'main'), null)
    assert.equal(branchUrl('data:text/html,<script>alert(1)</script>', 'main'), null)
    assert.equal(branchUrl('file:///etc/passwd', 'main'), null)
    assert.equal(branchUrl('vbscript:msgbox(1)', 'main'), null)
  })

  it('returns null for SSH-style git URLs', () => {
    // `git@github.com:org/repo.git` is not a valid URL per WHATWG; surfaces
    // as a parse failure today. The Done banner falls back to plain copy.
    assert.equal(branchUrl('git@github.com:example/x.git', 'main'), null)
  })
})
