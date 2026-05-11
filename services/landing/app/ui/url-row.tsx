import type { RemixNode } from 'remix/ui'

export interface UrlRowProps {
  url: string
  /**
   * Trailing-slot content rendered after the URL — typically a
   * `<CopyButton>` clientEntry. Sits at the right edge of the row.
   */
  children?: RemixNode
}

/**
 * URL row — paper-2 sunken pill with the scheme greyed out and
 * the rest of the URL ellipsised. Uses the `.wf-url-*` class
 * recipes in `blocks/url-row.css` (CUBE Block layer).
 *
 * The scheme/rest split runs at the JSX layer (no runtime cost):
 * everything up to and including the first `://` is the scheme;
 * everything after is the rest. URLs without a `://` render the
 * full string in the rest slot with no scheme.
 */
export function UrlRow() {
  return ({ url, children }: UrlRowProps) => {
    const split = splitScheme(url)
    return (
      <div class="wf-url-row">
        {split.scheme ? <span class="wf-url-scheme">{split.scheme}</span> : null}
        <span class="wf-url-rest">{split.rest}</span>
        {children ? <span class="wf-url-trail">{children}</span> : null}
      </div>
    )
  }
}

function splitScheme(url: string): { scheme: string; rest: string } {
  const idx = url.indexOf('://')
  if (idx === -1) return { scheme: '', rest: url }
  return { scheme: url.slice(0, idx + 3), rest: url.slice(idx + 3) }
}
