import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'
import { Logo } from './logo.tsx'

/**
 * Path-mode chrome — today's 44px header with a decorative URL
 * slug (`maria / openvoid.dev<path>`). Used by Home, the Create
 * flow, and every non-Ready session state.
 */
export interface PathChrome {
  mode: 'path'
  /** Decorative path appended to `openvoid.dev`. */
  path?: string
}

/**
 * Crumbs-mode chrome — 56px header with the workspace / repo
 * breadcrumb pair. Used by the Ready view.
 *
 * `workspace` is optional: v1 ships without a workspace segment
 * (auth-layer plumbing is deferred). When auth lands, pass the
 * workspace name here and the chrome upgrades to two-segment
 * shape automatically.
 *
 * `here` is the trailing segment, rendered in `var(--font-mono)`.
 * v1 ships the session-id prefix; full repo-name plumbing is
 * deferred.
 */
export interface CrumbsChrome {
  mode: 'crumbs'
  workspace?: string
  here: string
}

export type TopBarChrome = PathChrome | CrumbsChrome

export interface TopBarProps {
  /** Discriminated chrome shape — see `PathChrome` / `CrumbsChrome`. */
  chrome: TopBarChrome
  /**
   * Optional right-aligned slot — e.g. a Cancel link, an Avatar,
   * or a status pill. The wireframes use this to vary chrome
   * across routes (Create → Cancel, Provisioning → Avatar,
   * Ready → LivePill + Avatar).
   */
  right?: RemixNode
}

/**
 * Browser-chrome-styled toolbar with the openvoid wordmark and a
 * right-aligned slot. The middle section varies by `chrome.mode`:
 *
 * - `path` (44px) — decorative `maria / openvoid.dev<path>` slug.
 * - `crumbs` (56px) — `<workspace> / <here>` breadcrumb in the
 *   canonical Tokens header shape.
 */
export function TopBar() {
  return ({ chrome, right }: TopBarProps) => {
    if (chrome.mode === 'crumbs') {
      const workspace = chrome.workspace && chrome.workspace.length > 0 ? chrome.workspace : null
      return (
        <header class="wf-toolbar wf-toolbar-tall">
          <Logo tall />
          <div mix={css({ width: '1px', height: '20px', background: 'var(--line)', margin: '0 4px' })} />
          <div
            class="wf-row"
            mix={css({ gap: '8px', fontSize: '13.5px', color: 'var(--ink-3)' })}
          >
            {workspace ? (
              <>
                <span class="wf-meta wf-fg-muted">{workspace}</span>
                <span class="wf-fg-faint">/</span>
              </>
            ) : null}
            <span
              mix={css({
                fontFamily: 'var(--font-mono)',
                color: 'var(--ink)',
                fontWeight: 'var(--fw-medium)',
              })}
            >
              {chrome.here}
            </span>
          </div>
          <div class="wf-spacer" />
          {right}
        </header>
      )
    }
    const path = chrome.path ?? ''
    return (
      <header class="wf-toolbar">
        <Logo />
        <div mix={css({ width: '1px', height: '18px', background: 'var(--wf-line)', margin: '0 4px' })} />
        <div class="wf-row" mix={css({ gap: '6px' })}>
          <span class="wf-muted" mix={css({ fontSize: '12.5px' })}>maria</span>
          <span class="wf-faint">/</span>
          <span mix={css({ fontSize: '12.5px', fontWeight: 500 })}>openvoid.dev{path}</span>
        </div>
        <div class="wf-spacer" />
        {right}
      </header>
    )
  }
}
