import type { Controller } from 'remix/fetch-router'
import type { routes } from '../../routes.ts'
import { render } from '../../render.tsx'
import { HomePage } from './page.tsx'

/**
 * Home controller.
 *
 * Unit 1: `index` renders the placeholder Create screen so the
 * scaffold's design tokens, layout primitives, and typography are
 * verifiable end-to-end. `create` is wired up in Unit 3 (form
 * validation + POST to the Session API + redirect to
 * `/sessions/:id`).
 */
export default {
  actions: {
    index() {
      return render(<HomePage />)
    },
    create() {
      // Placeholder — Unit 3 wires the form schema, idempotency-key
      // forwarding, and the upstream POST.
      return new Response('Not implemented yet — Unit 3', { status: 501 })
    },
  },
} satisfies Controller<typeof routes.home>
