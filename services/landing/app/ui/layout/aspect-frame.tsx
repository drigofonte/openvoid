import type { RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

export interface AspectFrameProps {
  /** Aspect ratio. Accepts any valid `aspect-ratio` value. Defaults to `16 / 9`. */
  ratio?: string
  id?: string
  children?: RemixNode
}

/**
 * Every Layout Frame — locks its content to a fixed aspect ratio,
 * cropping overflow. Renamed from `Frame` to avoid colliding with
 * `remix/ui`'s exported `Frame` (a streaming-content primitive).
 * The CSS class stays `.frame` because `composition.css` already
 * targets that selector. This component sets the `--ratio` custom
 * property; `composition.css` does the rest.
 */
export function AspectFrame() {
  return ({ ratio = '16 / 9', id, children }: AspectFrameProps) => (
    <div class="frame" id={id} mix={css({ '--ratio': ratio })}>
      {children}
    </div>
  )
}
