import * as http from 'node:http'
import { createRequestListener } from 'remix/node-fetch-server'

import { createLandingRouter } from './app/router.ts'

const router = createLandingRouter()

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000

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
