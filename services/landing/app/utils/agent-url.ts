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

/**
 * Composes the agent-facing URL the Ready surfaces hand to the user.
 *
 * When the Session API has resolved the auto-seeded `Main` session
 * (`agentSessionId` present — only on new-app pods), returns the
 * deep-link form so the user lands directly inside the conversation.
 *
 * When `agentSessionId` is absent (import-repo pods, which have no
 * seed-agent and no auto-seeded Main), falls back to the bare
 * `agentUrl` — the agent SPA opens on its project picker as today's
 * pre-deep-link behavior. R7 honors this: import-repo flows are
 * unchanged by the deep-link feature.
 */
export function agentLinkUrl(agentUrl: string, agentSessionId?: string): string {
  return agentSessionId ? agentDeepLinkUrl(agentUrl, agentSessionId) : agentUrl
}
