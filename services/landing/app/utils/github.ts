/**
 * Build a `https://github.com/<owner>/<repo>/tree/<branch>` URL from
 * the user-submitted repo URL plus a branch.
 *
 * - `.git` suffix is stripped.
 * - Trailing slashes are stripped.
 * - Embedded credentials (`https://user:pat@github.com/...`) are
 *   stripped before display so the Done banner doesn't leak the PAT
 *   that the agent's clone may have used.
 * - Branch names with slashes (`feat/sid`) are URL-encoded so the
 *   resulting URL stays valid.
 *
 * Returns `null` when the input cannot be parsed as a URL, OR
 * when the URL uses a non-HTTP(S) scheme (`javascript:`, `data:`,
 * `file:`, …). The Done banner renders this string as an `<a href>`,
 * so dangerous schemes would be a clickable XSS vector.
 *
 * The UI falls back to plain copy when this returns `null`.
 */
export function branchUrl(repoUrl: string, branch: string): string | null {
  let url: URL
  try {
    url = new URL(repoUrl)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  url.username = ''
  url.password = ''
  url.hash = ''
  url.search = ''

  let pathname = url.pathname.replace(/\/+$/, '')
  pathname = pathname.replace(/\.git$/i, '')
  url.pathname = pathname

  const base = url.toString().replace(/\/+$/, '')
  return `${base}/tree/${encodeURIComponent(branch)}`
}
