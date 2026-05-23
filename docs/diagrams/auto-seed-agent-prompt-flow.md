---
title: "Auto-seed prompt flow — landing form to agent's first turn"
type: diagram
date: 2026-05-23
related:
  - docs/plans/2026-05-22-001-feat-auto-seed-agent-prompt-plan.md
  - infra/images/opencode/seed-agent.sh
  - infra/images/opencode/README.md (Seed-on-boot)
  - docs/spikes/2026-05-02-opencode-endpoints.md
---

# Auto-seed prompt flow

How the user's landing-form prompt gets from the browser to the OpenCode
agent's first turn at session boot. The key transport: the prompt rides
on the **pod manifest itself** as an env var on the `workspace-init`
initContainer — it never traverses cluster network *into* the pod after
creation.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Landing as Landing<br/>(Remix)
    participant API as Session API<br/>(TS)
    participant K8s as K8s API
    participant Init as workspace-init<br/>(initContainer)
    participant FS as /workspace/repo/app/<br/>scaffold-meta.json
    participant Entry as entrypoint.sh<br/>(PID 1)
    participant Seed as seed-agent.sh<br/>(child)
    participant OC as opencode serve<br/>(child, :8080)
    participant LLM as LLM provider

    User->>Landing: Type prompt, submit
    Landing->>API: POST /sessions<br/>{ mode:"new-app", prompt:"…" }
    Note over API: buildSessionPodManifest()<br/>injects OPENVOID_NEW_APP=true<br/>+ OPENVOID_SEED_PROMPT (etc.)<br/>onto workspace-init's env
    API->>K8s: create Pod (spec includes prompt<br/>in workspace-init env var)
    API-->>Landing: 201 { sessionId }
    Landing-->>User: redirect to session screen<br/>(may not be opened yet)

    rect rgb(245, 245, 245)
    Note over K8s,FS: Pod boot — initContainer phase
    K8s->>Init: start (env has the prompt)
    Init->>FS: write { prompt, createdAt, scaffoldVersion }<br/>(scaffold cloned, prompt persisted)
    Init-->>K8s: exit 0
    end

    rect rgb(245, 245, 245)
    Note over K8s,LLM: Pod boot — main container phase
    K8s->>Entry: start (OPENVOID_NEW_APP=true)
    Entry->>OC: opencode serve & (background)
    Entry->>Seed: seed-agent & (background)
    Note over Entry: wait -n DEV_PID OPENCODE_PID<br/>(SEED_PID excluded — seed exit<br/>must not collapse pod)

    Seed->>FS: jq -r '.prompt' (read + char-slice)
    loop until healthy or 120s
        Seed->>OC: GET /global/health<br/>(loopback 127.0.0.1:8080)
        OC-->>Seed: {healthy:true}
    end

    Seed->>OC: GET /session<br/>(find by title "Main")
    OC-->>Seed: [] (none yet)
    Seed->>OC: POST /session { title:"Main" }
    OC-->>Seed: { id: "ses_…" }

    Seed->>OC: POST /session/{id}/message<br/>{ parts:[{type:"text", text:framed_prompt}],<br/>  agent:"build" }
    Note over OC,LLM: BLOCKING — full agent turn<br/>(SSE stream, minutes)
    OC->>LLM: chat completion
    LLM-->>OC: tool calls + text
    OC-->>Seed: SSE stream (closes on turn-end)
    Seed->>Seed: wc -c response — non-empty?<br/>write sentinel, exit 0
    end

    Note over User: Later…
    User->>Landing: Click "Open agent"
    Landing->>OC: agent UI loads session<br/>(conversation already in progress<br/>or complete)
```

## Mental-model notes

- **Transport for the prompt:** Session API embeds the prompt in the
  pod manifest's env block (step 3). `workspace-init` reads from its
  own env (step 5) and writes to the `emptyDir` volume. `seed-agent`
  reads from the same volume (step 9). No post-creation HTTP into the
  pod is involved.
- **Why a file, not a pipe:** initContainers always exit before the
  main container starts, so they cannot share memory or stdin. The
  `emptyDir` mounted at `/workspace` is the only cross-container
  channel; `scaffold-meta.json` is the contract.
- **Why loopback for all `seed-agent` → OpenCode calls:** the agent's
  public URL goes through an Ingress that may not yet be wired when
  the seed runs, and we have a documented loopback trap from
  `docs/solutions/runtime-errors/landing-ingress-probe-stuck-running-pre-ingress-2026-05-09.md`.
  `127.0.0.1:8080` is reachable the instant `opencode serve` binds.
- **Why `SEED_PID` is excluded from `wait -n`:** the entrypoint exits
  when the first named child dies. A successful seed exit (`exit 0`
  after `write_sentinel`) must not collapse the pod — only `pnpm dev`
  or `opencode serve` deaths should.

## Failure-mode coverage

The diagram shows the happy path. Failure classifications (transient
vs. permanent, sentinel-or-not) are documented in
`infra/images/opencode/README.md` "Seed-on-boot → Failure handling"
and operator-side in `docs/runbooks/platform-github-org-setup.md`
"Troubleshooting — seed-on-boot not firing".
