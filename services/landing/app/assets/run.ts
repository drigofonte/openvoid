import { run } from 'remix/ui'

/**
 * Browser boot module. Loaded as `<script type="module" src="/_rmx/app/assets/run.ts">`
 * from the document `<head>`. The asset server compiles this to JS
 * on demand via the `/_rmx/*` route in the router.
 *
 * `run()` scans the document for client-entry comment markers
 * emitted by SSR, dynamic-imports each entry's compiled module,
 * and hydrates it. After this, `clientEntry`-wrapped components
 * become live and can call `handle.update()`, `handle.frame.reload()`,
 * etc.
 */

const app = run({
  async loadModule(moduleUrl, exportName) {
    const mod = await import(moduleUrl)
    return mod[exportName]
  },
  async resolveFrame(src, signal, target) {
    const headers = new Headers({ accept: 'text/html' })
    if (target) headers.set('x-remix-target', target)
    const response = await fetch(src, { headers, signal })
    return response.body ?? (await response.text())
  },
})

app.addEventListener('error', (event) => {
  console.error('[remix-runtime] component error:', event.error)
})

await app.ready()
