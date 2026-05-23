import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  AGENT_PROJECT_PATH_B64,
  agentDeepLinkUrl,
  agentLinkUrl,
} from '../../app/utils/agent-url.ts'

describe('agentDeepLinkUrl', () => {
  it('composes the deep-link URL for an agentUrl with a trailing slash', () => {
    assert.equal(
      agentDeepLinkUrl('http://abc.agent.example/', 'ses_xyz'),
      'http://abc.agent.example/L3dvcmtzcGFjZS9yZXBv/session/ses_xyz',
    )
  })

  it('composes the deep-link URL for an agentUrl without a trailing slash', () => {
    assert.equal(
      agentDeepLinkUrl('http://abc.agent.example', 'ses_xyz'),
      'http://abc.agent.example/L3dvcmtzcGFjZS9yZXBv/session/ses_xyz',
    )
  })

  it('produces exactly one slash before the encoded path segment when input has a trailing slash', () => {
    const url = agentDeepLinkUrl('http://abc.agent.example/', 'ses_xyz')
    assert.doesNotMatch(url, /\/\/L3dvcmtzcGFjZS9yZXBv/)
    assert.match(url, /example\/L3dvcmtzcGFjZS9yZXBv/)
  })
})

describe('AGENT_PROJECT_PATH_B64', () => {
  it('decodes to /workspace/repo (lockstep with Dockerfile WORKDIR)', () => {
    assert.equal(
      Buffer.from(AGENT_PROJECT_PATH_B64, 'base64').toString('utf8'),
      '/workspace/repo',
    )
  })

  it('matches the WORKDIR baked into infra/images/opencode/Dockerfile (cross-file lockstep)', () => {
    // The decoded constant must equal the live Dockerfile WORKDIR.
    // Without this guard, a future PR that changes the WORKDIR
    // (e.g. /workspace/app) would silently break every deep-link
    // URL: OpenCode falls back to the project picker, no error
    // surface, no logged signal — the same trap the seed-agent.sh
    // SESSION_TITLE content-guard test closes for the MAIN_SESSION_TITLE
    // contract.
    const dockerfilePath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../infra/images/opencode/Dockerfile',
    )
    const dockerfile = readFileSync(dockerfilePath, 'utf8')
    // The Dockerfile has multiple WORKDIR directives across build
    // stages (builder vs runtime). The LAST one is the agent
    // process's cwd at container start — that's the path that must
    // match the deep-link constant.
    const workdirMatches = [...dockerfile.matchAll(/^WORKDIR\s+(\S+)\s*$/gm)]
    assert.ok(
      workdirMatches.length > 0,
      'expected at least one WORKDIR line in infra/images/opencode/Dockerfile',
    )
    const runtimeWorkdir = workdirMatches[workdirMatches.length - 1][1]
    const decoded = Buffer.from(AGENT_PROJECT_PATH_B64, 'base64').toString('utf8')
    assert.equal(
      decoded,
      runtimeWorkdir,
      `AGENT_PROJECT_PATH_B64 decoded (${decoded}) must match Dockerfile runtime WORKDIR (${runtimeWorkdir}) — lockstep contract`,
    )
  })
})

describe('agentLinkUrl', () => {
  it('returns the deep-link form when agentSessionId is present', () => {
    assert.equal(
      agentLinkUrl('http://abc.agent.example/', 'ses_xyz'),
      'http://abc.agent.example/L3dvcmtzcGFjZS9yZXBv/session/ses_xyz',
    )
  })

  it('falls back to the bare agentUrl when agentSessionId is undefined (import-repo)', () => {
    // Import-repo pods never auto-seed a Main session, so the
    // Session API legitimately returns Running with both URLs but
    // no agentSessionId. agentLinkUrl preserves today's pre-deep-
    // link UX for that path (R7).
    assert.equal(
      agentLinkUrl('http://abc.agent.example/'),
      'http://abc.agent.example/',
    )
  })

  it('falls back to the bare agentUrl when agentSessionId is an empty string', () => {
    // Defensive: a server bug returning agentSessionId='' should not
    // produce a malformed deep-link URL with a trailing /session/.
    assert.equal(
      agentLinkUrl('http://abc.agent.example/', ''),
      'http://abc.agent.example/',
    )
  })
})
