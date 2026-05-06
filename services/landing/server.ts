import * as http from 'node:http'
import { setDefaultResultOrder } from 'node:dns'
import { createRequestListener } from 'remix/node-fetch-server'

import { createLandingRouter } from './app/router.ts'

// Force IPv4-first DNS resolution. Node 18+ defaults to `verbatim`,
// which respects whatever order the OS resolver returns. On macOS
// + Docker Desktop + nip.io, that often puts `::1` ahead of
// `127.0.0.1`, and Node's fetch (via Undici) does not always fall
// back cleanly when the IPv6 connection is refused — the request
// surfaces as `ECONNREFUSED 127.0.0.1:80` (the IPv4 address from
// the URL is a red herring; the actual attempt was on `::1`).
//
// Affects every outbound HTTP call from this server, including
// the Session API client and ingress-readiness probes. IPv4-first
// is the right default for kind-on-localhost and DOKS via
// cloudflared (both bind IPv4); revisit if/when we deploy onto an
// IPv6-only network.
setDefaultResultOrder('ipv4first')

const router = createLandingRouter()

const port = (() => {
  if (!process.env.PORT) return 3000
  const parsed = Number.parseInt(process.env.PORT, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid PORT env var: ${JSON.stringify(process.env.PORT)} — expected a positive integer`)
  }
  return parsed
})()

const server = http.createServer(
  createRequestListener(async (request) => {
    try {
      return await router.fetch(request)
    } catch (error) {
      console.error(error)
      return new Response('Internal Server Error', { status: 500 })
    }
  }),
)

server.listen(port, () => {
  console.log(`openvoid landing listening on http://localhost:${port}`)
  if (process.env.OPENVOID_API_URL) {
    console.log(`Session API: ${process.env.OPENVOID_API_URL}`)
  } else {
    console.log('OPENVOID_API_URL is not set — controllers that call the Session API will fail.')
  }
})

let shuttingDown = false

function shutdown(signal: string): void {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Received ${signal}, shutting down...`)
  server.close(() => process.exit(0))
  server.closeAllConnections()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
