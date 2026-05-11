import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'
import { Logo } from './logo.tsx'

/**
 * Path-mode chrome — header content variant with a decorative URL
 * slug (`maria / openvoid.dev<path>`). Used by Home, the Create
 * flow, and every non-Ready session state.
 *
 * Shape is now governed by the canonical `.app-shell header` rule
 * (single 56px height) — the path/crumbs distinction is content,
 * not chrome dimensions.
 */
export interface PathChrome {
  mode: 'path'
  /** Decorative path appended to `openvoid.dev`. */
  path?: string
}

/**
 * Crumbs-mode chrome — header content variant with the workspace /
 * repo breadcrumb pair. Used by the Ready view.
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
 * Renders the App Shell's `<header>` element. Shape (56px, sticky,
 * paper bg, line border-bottom) is governed by `.app-shell header`
 * in `compositions/app-shell.css`. The middle section varies by
 * `chrome.mode`:
 *
 * - `path` — decorative `maria / openvoid.dev<path>` slug.
 * - `crumbs` — `<workspace> / <here>` breadcrumb.
 *
 * Both modes use the tall Logo and a 20px vertical divider since
 * the shared 56px chrome accommodates the larger glyph proportions.
 */
export function TopBar() {
  return ({ chrome, right }: TopBarProps) => {
    if (chrome.mode === 'crumbs') {
      const workspace = chrome.workspace && chrome.workspace.length > 0 ? chrome.workspace : null
      return (
        <header>
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
      <header>
        <Logo tall />
        <div mix={css({ width: '1px', height: '20px', background: 'var(--line)', margin: '0 4px' })} />
        <div class="wf-row" mix={css({ gap: '6px' })}>
          <span class="wf-muted" mix={css({ fontSize: '13.5px' })}>maria</span>
          <span class="wf-faint">/</span>
          <span mix={css({ fontSize: '13.5px', fontWeight: 500 })}>openvoid.dev{path}</span>
        </div>
        <div class="wf-spacer" />
        {right}
      </header>
    )
  }
}
