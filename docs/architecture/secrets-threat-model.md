---
date: 2026-05-24
updated: 2026-05-27
status: draft
related:
  - docs/architecture/secrets-sequence-diagrams.md
  - docs/architecture/secrets-device-requirements.md
  - docs/ideation/2026-05-23-roadmap-to-public-do-release-ideation.md
---

# Secrets Management — Threat Model

> **Draft.** Companion to [secrets-sequence-diagrams.md](./secrets-sequence-diagrams.md) (runtime flows) and [secrets-device-requirements.md](./secrets-device-requirements.md) (passkey-PRF prerequisites — a hard gate at signup, not a degradation path).
>
> **One-tier architecture.** Passkey enrolment is required at signup; users whose browser or authenticator cannot satisfy WebAuthn-PRF cannot create accounts. There is no degraded-mode fallback. This simplifies the threat model — every user gets the full guarantees below.

## 1. Scope

This document describes the threat model for user-owned secrets in OpenVoid: the BYOK API keys (OpenRouter at v1, third-party service integrations at v1.5+) that users provide for their coding sessions and generated apps.

**In scope**

- User BYOK secrets (OpenRouter at v1; per-app integration secrets like Stripe, Supabase from v1.5)
- The KEK derivation and envelope encryption flow
- OpenBao deployment and access patterns
- The per-session pod's secret materialisation path

**Out of scope (covered elsewhere)**

- Platform-owned secrets (GitHub Org PAT, Cloudflare credentials, TLS certs) — handled via SOPS + Shamir-split off-platform
- User authentication mechanics — separate threat model
- Generated-app vulnerabilities — covered by the secrets guardrail / egress allowlist work (survivor 7 in the roadmap)
- Network-level attacks — Phase 10 NetworkPolicy work
- DDoS, abuse, rate limiting — separate concern

## 2. Assets

| Asset | Sensitivity | Location | Lifecycle |
|---|---|---|---|
| User passkey (private key) | Critical | User device hardware (Secure Enclave / TPM / hardware key) | Permanent until user revokes |
| Passkey-PRF output | Critical | Browser memory during auth flow only | Per-request |
| User KEK (derived from PRF) | Critical | Session API request-scoped memory only | Per-request |
| User-scope DEK (wrapped by user KEK) | High | OpenBao transit engine | Lifetime of user |
| Per-app DEK (wrapped by user KEK) | High | OpenBao transit engine | Lifetime of app |
| User-scope user-stored secret (e.g., OpenRouter dev key) | High | OpenBao KV, encrypted by user-scope DEK | Until user revokes |
| App-scope user-stored secret (e.g., Zapier; deployed-app OpenRouter) | High | OpenBao KV, encrypted by per-app DEK | Until user revokes |
| Recovery codes | Critical | User device only (display-once) + server-side Argon2id hash | Until rotated |
| OpenBao unseal keys | Critical | Shamir-split across ≥3 humans, off-platform | Until rotated |
| Audit log | Medium | Append-only, off-cluster sink | 90 days |

### 2.1 Secret scope hierarchy

User-supplied secrets exist at two scopes:

- **User-scope** — secrets the user provides once and that apply across every app they build on openvoid. Example: the user's own OpenRouter API key used to *pay for their own coding-session LLM calls* across all their apps. Wrapped under a single `user-dek-{userId}` transit key per user.
- **App-scope** — secrets the user provides per app, scoped to one app's pod identity. Example: a Zapier API key consumed by one app, or an OpenRouter key consumed by a *deployed* app the user built (different from the dev-time key above). Wrapped under `app-dek-{appId}`, one per app.

Both scopes are wrapped by the same user KEK at the envelope layer (no scope-specific KEK derivation).

**Collision rule at session start.** A user-scope secret and an app-scope secret may share the same environment variable name (`OPENROUTER_API_KEY` is the canonical case — dev-time vs deployed-app). When this happens, the **app-scope value overrides the user-scope value** in the per-session pod's environment, and an audit event records the override (`secret.scope_collision_overridden`) so the operator can see when an app's local value is shadowing the user's default.

**Path layout (ownership-neutral).** Storage paths separate "what scope the secret belongs to" from "who can access it":

- User-scope: `secret/data/users/{userId}/integrations/{name}`
- App-scope: `secret/data/apps/{appId}/integrations/{name}`

Access control is enforced at the OpenBao policy layer, not by encoding ownership into the path. At v1 every app has exactly one owner, but the policy machinery is membership-aware from the start so multi-member apps (v2 teams) extend without path migration.

**Future scope: teams (v2, not in v1 scope).** Multi-user teams that share and maintain the same apps are a planned v2 capability. The cryptographic architecture extends without breaking changes: a team-scope DEK (`team-dek-{teamId}`) would be wrapped *N times*, once per member's user KEK, via the standard 1Password / Bitwarden team-vault envelope pattern. Membership changes trigger re-wrap (member added) or rotate-and-re-wrap-for-remaining (member removed). v1 explicitly assumes single-user-per-app ownership; the path layout above is the only v1 concession to keeping that future open.

## 3. Trust Boundaries

```
[User Device]  ──TLS──>  [Landing / Session API]  ──K8s SA JWT──>  [OpenBao]
                                     │
                                     ▼
                        [Per-Session Pod (tmpfs only)]
```

- **TB1** — User device ↔ platform (TLS terminus)
- **TB2** — Session API ↔ OpenBao (K8s SA JWT auth; OpenBao trusts the SA, not the running code)
- **TB3** — Session API ↔ Per-session Pod (pod runs untrusted agent + user code; API treats pod as semi-hostile)
- **TB4** — Per-session Pod ↔ external network (NetworkPolicy + declared egress allowlist)

## 4. Threat Actors

| Actor | Capability | Motivation |
|---|---|---|
| External attacker (unauthenticated) | Network access to public surface | Credential theft, BYOK key resale |
| Authenticated malicious user | Valid session, runs arbitrary code in own pod | Pivot to other users' secrets, map platform internals |
| Compromised user device | Has user's passkey + can invoke PRF | Exfiltrate that user's secrets |
| Malicious / coerced platform operator | Read access to OpenBao DB, cluster-admin | Exfiltrate user secrets at rest |
| Cloud provider (DO) | Physical / hypervisor access | Out of practical scope; design must not give them plaintext |
| Supply-chain attacker | Can publish a malicious version of a Session API dependency | Backdoor Session API to exfiltrate KEK during request window |

## 5. Threats and Mitigations

### T1 — OpenBao storage backend exfiltration

**Attack.** SQL injection, leaked snapshot, compromised storage backend.

**Mitigation.** Layer 1. The DB holds per-user salts, DEK ciphertexts (both user-scope and app-scope, all wrapped by user KEK), and secret ciphertexts (encrypted by their respective scope's DEK). The user KEK is reconstructed from passkey-PRF at request time and never persisted. Attacker has ciphertext only.

**Residual risk.** Metadata correlation (which users own which apps, integration counts, names, which apps have app-scope secrets vs only inherit user-scope). Decryption requires user-side compromise.

### T2 — Session pod compromise, pivot within same user

**Attack.** Vulnerable npm dep installed by the agent achieves RCE; pod's OpenBao token is reused for other paths.

**Mitigation.** Layer 3 policy template scopes the token to exactly: (a) `secret/data/apps/{thisAppId}/*` + `transit/decrypt/app-dek-{thisAppId}` for app-scope, and (b) `secret/data/users/{userId}/*` + `transit/decrypt/user-dek-{userId}` for user-scope. TTL = session lifetime. Reads of *other* apps (`apps/{otherAppId}`) and *other* users (`users/{otherUserId}`) remain denied + audited. The policy is generated from a join of "this session's user is the requester" and "this session's app belongs to that user" — at v1 every app has exactly one owner, but the join machinery is ownership-neutral so v2 team membership extends without policy redesign.

**Residual risk.** Within a single session, an attacker reads all that app's app-scope secrets plus all of the user's user-scope secrets. The user-scope inclusion is by design — user-scope secrets exist precisely so they are reachable from every session the user creates (otherwise the dev-time OpenRouter key model would not work). App-scope isolation still prevents pivot to *other* apps. Operators evaluating blast radius should treat the per-session-pod compromise as "all of one app's secrets + all of the user's cross-app secrets," not "all secrets of one user."

### T3 — Session pod compromise, pivot cross-user

**Mitigation.** Same policy template; cross-user paths are not in the policy. K8s SA JWT is bound to the specific session pod, not portable.

**Residual risk.** None at OpenBao layer; would require T6 (Session API compromise).

### T4 — Backup leak (OpenBao or storage backend)

**Mitigation.** Same as T1 — ciphertext only. Backups additionally encrypted with a separate key managed via SOPS + Shamir, not stored in OpenBao (avoids circular dependency).

**Residual risk.** Metadata correlation as T1.

### T5 — Malicious platform operator

**Mitigation.** Operator can observe ciphertext at rest. To decrypt requires (a) modifying running Session API to intercept in-memory KEK during a user request, or (b) compromising user passkey out-of-band. Path (a) is detectable: cosign image attestation + Kyverno admission, audit log shipped off-cluster, separation-of-duties for cluster-admin grants.

**Residual risk.** Persistent attacker with cluster-admin who patches the Session API binary AND waits for a target user to log in CAN exfiltrate KEK during the request window. Honest acknowledgement: this is the highest residual; defence is detection + revocation, with an explicit incident-response runbook and 24-hour ceiling on undetected compromise via mandatory audit review.

### T6 — Session API RCE

**Attack.** Session API has the K8s SA that can mint per-session OpenBao tokens for any (user, app). Compromise = ability to mint tokens for any user during any request window.

**Mitigation.** Minimal dependency surface, request authentication, real-time audit shipping for fast post-compromise detection, and crucially — minting a token only enables decryption *during the window in which the user is also providing a fresh PRF assertion*. Attacker cannot decrypt at-rest data without inducing user activity.

**Residual risk.** Users actively logging in during the compromise window are exposed. Mitigation degrades to detection + global session revocation + rotation runbook.

### T7 — Agent embeds user secret in generated code (Lovable failure mode)

**Attack.** User adds Supabase key for app integration. Agent writes app code that includes the key value in a generated file; finalizer pushes; secret leaks to GitHub.

**Mitigation.** Agent never sees the secret value — only an env var name (`$SUPABASE_SERVICE_ROLE_KEY`). Pod runtime injects from CSI-mounted tmpfs at startup; agent is hard-prompted that referencing values directly is prohibited. Finalizer runs trufflehog-style scan before push and refuses commits matching known secret shapes.

**Residual risk.** If the user's app code legitimately reads the env var and writes it to a client-side bundle (a common Supabase misuse), the secret leaks via the published preview. This is a generated-app vulnerability; addressed by the egress allowlist + sandbox tier work and by onboarding UX that surfaces the risk.

### T8 — Compromised user device with active session

**Mitigation.** User-side primarily. Platform contributes: short session TTLs, "revoke all sessions from another device" surface, audit visibility into "which device/IP accessed which secret when."

**Residual risk.** Full device compromise = full secret compromise for that user. Same as every E2E system; documented residual.

### T9 — Passkey loss without recovery codes

**Mitigation.** 10 recovery codes generated at first login, displayed once, stored Argon2id-hashed. Recovery codes are a separate derivation path to the same KEK (see [Diagram 4](./secrets-sequence-diagrams.md#diagram-4--device-loss-recovery)). Multi-device passkey sync (iCloud Keychain, Google Password Manager) is the primary mitigation for most users.

**Residual risk.** Loss of all passkeys *and* all recovery codes = loss of all secrets. By design — matches Signal / Apple model. Documented in onboarding.

### T10 — Supply-chain attack on a Session API dependency

**Mitigation.** Lockfile-pinned dependencies, cosign image attestation, admission controller verifying signatures, dependency review on majors, automated SCA on every PR.

**Residual risk.** Zero-day in a pinned dependency before detection. Degrades to detection + rapid rotation, supported by audit log replay.

### T11 — PRF assertion replay

**Attack.** Attacker intercepts a WebAuthn assertion (or its raw PRF output) and replays it to derive a KEK without the legitimate user's authenticator participating.

**Mitigation — assertion replay.** WebAuthn assertions are constructed as `signature = sign_credPrivKey(authenticatorData || SHA256(clientDataJSON))`, where `clientDataJSON` includes a server-generated `challenge` nonce. Server-side, three checks defeat assertion replay:

1. The `challenge` field is matched against a server-side challenge store; entries are single-use and TTL-bounded (5min).
2. The `rpIdHash` in `authenticatorData` is verified against the relying party identity.
3. The signature is verified under the credential public key stored at registration.

A replayed assertion fails check (1) because the challenge has already been consumed (or has expired). An attacker without the credential private key — which never leaves the authenticator — cannot forge a fresh-challenge assertion.

**Mitigation — PRF output replay.** The PRF output itself is deterministic per `(credential, salt)`. The raw `prf_output` bytes therefore *are* replayable if an attacker can capture them — but they are useful only to an attacker who can also invoke the server-side derivation path with those bytes. The bytes exist in exactly two places: the browser memory during a single auth flow, and the Session API request-scoped memory during a single request. Outside those windows — at rest, in transit (TLS, per A3), in backups — the bytes do not exist to capture.

**Residual risk.** A platform compromise during an active user request window (T5, T6) allows in-memory PRF-output capture. Once captured, the bytes can be reused to re-derive the KEK for that user indefinitely until the user's salt is rotated. Detection (A4) and remediation (force re-enrol with new salt, per §6.3) are the only responses once the bytes have left memory. External interception — outside a platform compromise, outside a TLS break — is not possible.

## 6. Key rotation procedures

This section covers the operational surface around rotating the keys defined in §2. Three rotation flows are in scope: routine DEK rotation, KEK rotation on credential change, and emergency rotation after suspected compromise. Threats T1, T4, T5, T6, T8, T10, and T11 all degrade gracefully if rotation is timely; this section makes "timely" concrete.

### 6.1 Routine DEK rotation (user-scope and per-app)

**Trigger.** Scheduled (quarterly cadence at v1, configurable) or user-initiated from settings.

**Flow.** OpenBao transit supports versioned keys natively. Both `transit/keys/user-dek-{userId}/rotate` and `transit/keys/app-dek-{appId}/rotate` increment the key version; existing ciphertexts remain decryptable with their original version, and new encryptions use the latest version. A subsequent `transit/rewrap` operation re-encrypts existing ciphertext under the latest version. The rewrap step needs the user KEK to first unwrap the DEK, so it is bundled into the user's next login rather than run as an unattended background job. User-scope and per-app rotations run on independent cadences (a user with five apps has six rotation calendars: one for `user-dek-{userId}` and one each for the five `app-dek-{appId}`).

**Failure modes.**
- Rewrap interrupted mid-flight: idempotent — re-running picks up where it left off.
- New key version created but rewrap never completes: storage cost grows, no security impact; addressed by a periodic reconciliation job.

### 6.2 KEK rotation on credential change

**Trigger.** User adds a new passkey, removes a passkey, or completes the device-loss recovery flow ([Diagram 4](./secrets-sequence-diagrams.md#diagram-4--device-loss-recovery)).

**Flow.** A new passkey produces a different PRF output and therefore a different KEK. The user-master, the user-scope DEK, and every per-app DEK must be re-wrapped against the new KEK, or the new credential cannot decrypt anything. The re-wrap is bundled into the credential enrolment flow: both the previous credential's PRF output and the new credential's PRF output are gathered in the same session, both KEKs are derived in request-scoped memory, every wrapped key (user-master + user-DEK + N app-DEKs) is re-wrapped, and both KEKs are then zeroed per A7.

**Failure modes.**
- Process interrupted with new credential enrolled but re-wrap incomplete: old credential still works; re-wrap is retried on next login while both credentials are live.
- Old credential revoked before re-wrap completes: falls back to the recovery-code path (Diagram 4).

### 6.3 Emergency rotation after suspected compromise

**Trigger.** Audit log review surfaces suspicious access, T5/T6 indicators detected internally, or the user reports compromise.

**Flow (user-initiated).**
1. User authenticates with passkey; platform forces a salt rotation as part of the same flow.
2. New KEK derived from passkey-PRF + new salt.
3. User-master and all app DEKs re-wrapped under the new KEK.
4. All app DEKs rotated (`transit/keys/app-{appId}/rotate`); existing ciphertexts re-encrypted under the new versions.
5. All recovery codes invalidated; new codes generated and displayed once.
6. All active sessions revoked.

**Flow (platform-initiated, mass compromise).** When the Session API or OpenBao is suspected of compromise over an unknown window, every user who authenticated during the suspected window is force-logged-out and prompted through the user-initiated flow above. Audit log replay identifies the high-confidence exposure set. A public incident-response runbook governs the disclosure timeline.

**Out of scope at v1.** Automatic rotation enforcement (e.g., "rotate every 90 days") and rotation-from-policy. Both deferred until usage data informs sensible defaults.

## 7. Session-creation freshness policy

**Decision (v1).** Every session creation requires a fresh passkey assertion. There is no pre-staging of user-decrypted secrets to a per-user OpenBao path between sessions.

**Rationale.** Pre-staging would widen the T5/T6 residual window from "a single request" to "the entire login session" (10min–1h depending on lease TTL). For OpenVoid's audience — sophisticated users intentionally creating coding sessions — one passkey touch per session creation is an acceptable UX cost in exchange for the tighter envelope. The mental model is also simpler: KEK lifetime equals request lifetime, full stop. No "is my staged data still valid?" branching anywhere in the system.

**Deferred.** A "convenience mode" opt-in that pre-stages user-decrypted material to a per-user path with short TTL after login. Will be re-evaluated if usage data shows session-creation frequency that makes per-session touches a real friction point. If introduced, it must be: per-user opt-in (not platform default), surfaced clearly in audit logs (`convenience mode enabled at {ts}, expires at {ts+TTL}`), and constrained to a TTL shorter than the OpenBao session token TTL so it cannot extend the exposure window further than a session already extends it.

## 8. Assumptions

- **A1** — User device hardware (Secure Enclave / TPM / hardware key) is uncompromised.
- **A2** — Browser correctly implements WebAuthn-Level-3 + PRF extension.
- **A3** — TLS is terminated correctly with cert validation enforced everywhere.
- **A4** — OpenBao audit log is shipped off-cluster in real-time and reviewed daily; alerting fires on T5/T6 indicators within 1 hour.
- **A5** — Cluster-admin access is restricted to ≤2 humans with separation-of-duties for production grants.
- **A6** — Image attestation (cosign + Kyverno) prevents unsigned images from running.
- **A7** — KEK and DEK material is held in request-scoped Node.js `Buffer` allocations and overwritten with zeros before the request handler returns. V8 heap management, string-conversion intermediates, and GC copies mean deterministic zeroing is **not guaranteed**; this is a defense-in-depth practice, not a primary mitigation. The actual security lifting is done by TB2/TB3 (process isolation), A4 (audit), and A6 (admission attestation). A future hardening pass may move key material into a native module (e.g., sodium-native) backed by `mlock`'d off-heap memory to give the zeroing claim teeth.

## 9. Out-of-scope failure modes

- State actor with persistent multi-vector capability — documented so reviewers see it was considered, not because it is defended.
- User who declines recovery codes and loses their only passkey — UX problem, not architecture.
- Generated app leaking its own runtime secret via client-side bundle — generated-app vuln; covered by egress allowlist + onboarding.

## 10. Revision history

- **2026-05-25** — Resolved the four open points from the initial draft: (1) replaced the implicit "zeroed" claim with honest best-effort wording in A7; (2) expanded T11 with the WebAuthn assertion structure and an explicit split between assertion replay and PRF-output replay; (3) added §6 covering routine, credential-change, and emergency key rotation; (4) recorded the v1 decision in §7 to require a fresh passkey touch on every session creation, with convenience-mode pre-staging deferred.
- **2026-05-27** — Added secret-scope hierarchy in §2.1 (user-scope vs app-scope) with the app-overrides-user collision rule and the audit event that records overrides. T2 mitigation reworked to grant per-session access to both scopes with ownership-neutral storage paths (`secret/data/users/{userId}/...` and `secret/data/apps/{appId}/...`). T2 residual risk widened honestly to "all of this app's secrets + all of the user's cross-app secrets" — the user-scope inclusion is by design. §6.1 rotation flows extended to both DEK families; §6.2 re-wrap chain extended to include user-scope DEK + every per-app DEK. Added v2 teams future-work note (multi-member apps extend via per-member envelope wrapping without breaking changes).
