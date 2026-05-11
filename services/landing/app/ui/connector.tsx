/**
 * Connector — animated SVG joining the duo of cards in the Ready
 * stage. The flow path uses a dashed stroke offset by the `flow`
 * keyframe (defined in `compositions/connector.css`) and ends with a chevron
 * arrowhead.
 *
 * Positioning + responsive rotation live on the `.wf-connector`
 * rule in `compositions/connector.css`. The container element (`.wf-connector-host`)
 * is set up by the consumer; this component just emits the SVG
 * inside the wrapper that consumers position absolutely.
 *
 * SVG attribute names use kebab-case throughout — Remix 3 only
 * preserves `aria-*`, `data-*`, `className`, `htmlFor`, `tabIndex`,
 * `acceptCharset`, and `httpEquiv`; everything else lowercases
 * silently. Camel-case `viewBox` would render as `viewbox`, which
 * the browser ignores.
 *
 * @link docs/solutions/best-practices/remix-3-jsx-attribute-naming-2026-05-06.md
 */
export function Connector() {
  return () => (
    <div class="wf-connector" aria-hidden="true">
      <svg
        viewBox="0 0 120 60"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          class="wf-connector-flow"
          d="M 6 30 Q 60 -10 114 30"
        />
        <path
          d="M 109 25 L 116 30 L 109 35"
          stroke="var(--accent)"
          stroke-width="1.5"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>
  )
}
