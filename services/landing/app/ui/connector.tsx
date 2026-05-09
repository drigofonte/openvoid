/**
 * Connector — animated SVG joining the duo of cards in the Ready
 * stage. The flow path uses a dashed stroke offset by the `flow`
 * keyframe (defined in `blocks.css`) and ends with a chevron
 * arrowhead.
 *
 * Positioning + responsive rotation live on the `.wf-connector`
 * rule in `blocks.css`. The container element (`.wf-connector-host`)
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
          d="M 0 30 C 30 30, 60 10, 90 30 S 150 50, 120 30"
          fill="none"
        />
        <path
          d="M 110 24 L 120 30 L 110 36"
          stroke="var(--accent)"
          stroke-width="1.5"
          fill="none"
        />
      </svg>
    </div>
  )
}
