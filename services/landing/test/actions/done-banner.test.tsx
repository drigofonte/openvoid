import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { DoneBanner, parseDoneParams } from '../../app/actions/home/done-banner.tsx'

const SID = '01HABCDEF'

describe('parseDoneParams', () => {
  it('returns null when ?done is absent', () => {
    assert.equal(parseDoneParams(new URLSearchParams('')), null)
  })

  it('returns null when ?done is empty', () => {
    assert.equal(parseDoneParams(new URLSearchParams('done=')), null)
  })

  it('returns null when repo or branch is missing', () => {
    assert.equal(parseDoneParams(new URLSearchParams(`done=${SID}`)), null)
    assert.equal(parseDoneParams(new URLSearchParams(`done=${SID}&repo=https://github.com/x/y`)), null)
    assert.equal(parseDoneParams(new URLSearchParams(`done=${SID}&branch=main`)), null)
  })

  it('returns the parsed shape when all three are present', () => {
    const params = new URLSearchParams({
      done: SID,
      repo: 'https://github.com/example/x.git',
      branch: 'main',
    })
    assert.deepEqual(parseDoneParams(params), {
      sessionId: SID,
      repo: 'https://github.com/example/x.git',
      branch: 'main',
    })
  })
})

describe('DoneBanner rendering', () => {
  it('renders the feat/<sid> branch label and a /tree/feat%2F... GitHub link', async () => {
    const html = await renderToString(
      <DoneBanner
        done={{ sessionId: SID, repo: 'https://github.com/example/x.git/', branch: 'main' }}
      />,
    )
    assert.match(html, /Saved/)
    assert.match(html, new RegExp(`feat/${SID}`))
    assert.match(html, new RegExp(`https://github\\.com/example/x/tree/feat%2F${SID}`))
    assert.match(html, /target="_blank"/)
  })

  it('strips embedded credentials before linking to GitHub', async () => {
    const html = await renderToString(
      <DoneBanner
        done={{
          sessionId: SID,
          repo: 'https://maria:ghp_TOKEN@github.com/example/x.git',
          branch: 'main',
        }}
      />,
    )
    assert.doesNotMatch(html, /ghp_TOKEN/)
    assert.doesNotMatch(html, /maria:/)
    assert.match(html, /https:\/\/github\.com\/example\/x\/tree\/feat%2F/)
  })

  it('omits the GitHub link when the repo URL is unparseable', async () => {
    const html = await renderToString(
      <DoneBanner done={{ sessionId: SID, repo: 'not a url', branch: 'main' }} />,
    )
    assert.match(html, /Saved/)
    assert.doesNotMatch(html, /View on GitHub/)
  })
})
