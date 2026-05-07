import { clientEntry, css, on, type Handle } from 'remix/ui'

/**
 * TipCarousel — "While you wait" tip card shown on Provisioning.
 *
 * SSR renders the first tip statically. On hydration the
 * clientEntry takes over: auto-rotates every 5 s, dots become
 * clickable, and clicking a dot pauses auto-rotation (so a user
 * who's reading isn't yanked away mid-sentence).
 *
 * Lives under sessions/client/ even though it has no Session-API
 * coupling — it's only mounted on the Provisioning view today.
 * If we ever want it on a non-session page we can hoist it.
 */

const TIPS = [
  "Tip: you can paste images, files, and Figma links directly into the agent chat. It'll figure out what to do with them.",
  'Tip: shorter prompts iterate faster. You can always ask the agent to expand on a feature once you see the first cut.',
  'Tip: the preview hot-reloads as the agent edits. Keep both tabs open in a split window for the best feedback loop.',
] as const

const ROTATE_MS = 5000

export const TipCarousel = clientEntry(
  import.meta.url,
  function TipCarousel(handle: Handle<Record<string, never>>) {
    let index = 0
    let paused = false
    let timer: ReturnType<typeof setInterval> | undefined

    function tick() {
      if (paused || handle.signal.aborted) return
      index = (index + 1) % TIPS.length
      // Swallow the rejection — `update()` can reject if the
      // component unmounts between the abort check and the call.
      handle.update().catch(() => {})
    }

    function pickDot(i: number) {
      paused = true
      index = i
      handle.update()
    }

    handle.signal.addEventListener('abort', () => {
      if (timer) clearInterval(timer)
    })

    // Only start the rotation in a browser context. The clientEntry
    // body also runs during SSR; without this guard, Node's
    // `setInterval` keeps the test process alive and can fire a
    // stray tick after the test runner has begun teardown.
    if (typeof document !== 'undefined') {
      timer = setInterval(tick, ROTATE_MS)
    }

    return () => (
      <div
        class="wf-card"
        mix={css({
          padding: '20px 24px',
          maxWidth: '440px',
          width: '100%',
          margin: '0 auto',
        })}
      >
        <div class="wf-col" mix={css({ gap: '8px' })}>
          <span class="wf-eyebrow">While you wait</span>
          <p mix={css({ fontSize: '14px', lineHeight: 1.5, margin: 0 })}>
            {TIPS[index]}
          </p>
          <div
            class="wf-row"
            role="tablist"
            aria-label="Tips"
            mix={css({ gap: '8px', marginTop: '4px' })}
          >
            {TIPS.map((_, i) => (
              <button
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Tip ${i + 1} of ${TIPS.length}`}
                mix={[
                  css({
                    width: '8px',
                    height: '8px',
                    borderRadius: '999px',
                    border: 'none',
                    padding: 0,
                    background: i === index ? 'var(--wf-accent)' : 'var(--wf-line)',
                    cursor: 'pointer',
                  }),
                  on<HTMLButtonElement>('click', () => pickDot(i)),
                ]}
              />
            ))}
          </div>
        </div>
      </div>
    )
  },
)

export const TIP_FALLBACK = TIPS[0]
