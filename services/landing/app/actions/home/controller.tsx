import type { Controller } from 'remix/fetch-router'
import { redirect } from 'remix/response/redirect'
import * as s from 'remix/data-schema'
import { minLength } from 'remix/data-schema/checks'
import * as f from 'remix/data-schema/form-data'

import type { routes } from '../../routes.ts'
import { ApiError, createSession } from '../../utils/api.ts'
import { render } from '../../render.tsx'
import { HomePage, type PreviousValues } from './page.tsx'
import { parseDoneParams } from './done-banner.tsx'

/**
 * Home controller.
 *
 * - `index` (GET /) renders the Create page; the optional Done
 *   banner appears above the form when the URL carries
 *   `?done=:id&repo=&branch=` (post-Stop redirect from
 *   `/sessions/:id`, Unit 4).
 * - `create` (POST /) validates the form, posts to the Session
 *   API, redirects to `/sessions/:id` on success, or re-renders
 *   the Create page with an inline error on validation /
 *   upstream failure.
 *
 * The double-submit defence is the `idempotencyKey` hidden field:
 * generated server-side on the GET render, **persisted across
 * POST re-renders** (a fresh key on retry would defeat upstream
 * dedup), forwarded to the Session API as `Idempotency-Key`.
 * The visual `clientEntry` "Starting…" button lands in Unit 4.
 */

const CreateSchema = f.object({
  idempotencyKey: f.field(s.string().pipe(minLength(1))),
  prompt: f.field(s.string().pipe(minLength(1))),
})

function asString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readPreviousValues(formData: FormData): PreviousValues {
  return {
    prompt: asString(formData.get('prompt')),
  }
}

export default {
  actions: {
    index({ url }) {
      const done = parseDoneParams(url.searchParams)
      return render(<HomePage done={done} idempotencyKey={crypto.randomUUID()} />)
    },
    async create({ get, url }) {
      const formData = get(FormData)
      const submittedKey = asString(formData.get('idempotencyKey'))
      const idempotencyKey = submittedKey ?? crypto.randomUUID()
      const done = parseDoneParams(url.searchParams)
      const previousValues = readPreviousValues(formData)

      const parsed = s.parseSafe(CreateSchema, formData)
      if (!parsed.success) {
        return render(
          <HomePage
            done={done}
            idempotencyKey={idempotencyKey}
            error={{ message: 'Please add a prompt to start a session.' }}
            previousValues={previousValues}
          />,
          { status: 400 },
        )
      }

      try {
        const session = await createSession(
          { mode: 'new-app', prompt: parsed.value.prompt },
          parsed.value.idempotencyKey,
        )
        return redirect(`/sessions/${session.sessionId}`)
      } catch (error) {
        if (error instanceof ApiError) {
          const status = error.status >= 400 && error.status < 600 ? error.status : 502
          return render(
            <HomePage
              done={done}
              idempotencyKey={parsed.value.idempotencyKey}
              error={{ message: error.message, code: error.code }}
              previousValues={previousValues}
            />,
            { status },
          )
        }
        throw error
      }
    },
  },
} satisfies Controller<typeof routes.home>
