import { css } from 'remix/ui'

import { branchUrl } from '../../utils/github.ts'

/**
 * Done-state info parsed from the home URL's `?done=`/`?repo=`/`?branch=`
 * query string. `null` when no done param is present.
 *
 * The redirect from `DELETE /sessions/:id` (Unit 4) carries the
 * pre-stop `repo` + `branch` so the Done banner can link to the
 * `feat/<sid>` branch on GitHub without re-fetching the session
 * (which is gone by the time the banner renders).
 */
export interface DoneParams {
  sessionId: string
  repo: string
  branch: string
}

/**
 * Parse the home URL's done-state query params.
 *
 * Returns `null` when `?done=` is absent or any required field is
 * empty. The Stop redirect always carries all three; partial sets
 * are treated as a malformed URL the user pasted, so the banner
 * stays hidden.
 */
export function parseDoneParams(searchParams: URLSearchParams): DoneParams | null {
  const sessionId = searchParams.get('done')
  if (!sessionId) return null
  const repo = searchParams.get('repo')
  const branch = searchParams.get('branch')
  if (!repo || !branch) return null
  return { sessionId, repo, branch }
}

export interface DoneBannerProps {
  done: DoneParams
}

export function DoneBanner() {
  return ({ done }: DoneBannerProps) => {
    const featBranch = `feat/${done.sessionId}`
    const url = branchUrl(done.repo, featBranch)
    return (
      <aside
        class="wf-card"
        mix={css({
          padding: '14px 16px',
          marginBottom: '24px',
          borderColor: 'var(--wf-ok)',
          background: 'var(--wf-ok-soft)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        })}
      >
        <span class="kicker" mix={css({ color: 'var(--wf-ok)' })}>
          Saved
        </span>
        <span mix={css({ fontSize: '14px' })}>
          Pushed to <code class="wf-mono">{featBranch}</code>
        </span>
        <span class="wf-spacer" />
        {url ? (
          <a class="wf-link" href={url} target="_blank" rel="noopener noreferrer">
            View on GitHub →
          </a>
        ) : null}
      </aside>
    )
  }
}
