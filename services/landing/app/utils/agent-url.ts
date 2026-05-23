/**
 * Base64 of the agent pod's project path (`/workspace/repo`).
 *
 * The OpenCode web UI's deep-link URL form embeds the project path
 * as a base64 segment so the agent SPA can land directly inside the
 * project (skipping the picker). The literal path here is the
 * `WORKDIR /workspace/repo` defined in `infra/images/opencode/Dockerfile`.
 *
 * Keep this constant in lockstep with that WORKDIR — if the Dockerfile
 * changes the work directory without updating this value, every
 * bookmarked deep-link will silently break (OpenCode falls back to
 * the picker, no error surface).
 */
export const AGENT_PROJECT_PATH_B64 = 'L3dvcmtzcGFjZS9yZXBv'

export function agentDeepLinkUrl(agentUrl: string, agentSessionId: string): string {
  return `${agentUrl.replace(/\/$/, '')}/${AGENT_PROJECT_PATH_B64}/session/${agentSessionId}`
}
