# Sidecar Containers vs. Custom Operators for Pod Lifecycle Management: A Practical Comparison for Git‑Backed Init/Finalization

For the specific scenario you described — an orchestrator‑driven init step that fetches code, a main agent container that does work, and a finalizer that needs to `git push` when the pod terminates, with a minimal Kubernetes learning curve — **the right answer is the native sidecar container pattern, not a custom CRD + Operator.** The native sidecar feature (GA in Kubernetes 1.33, on by default since 1.29) was designed precisely for "do something before the app, run alongside, and finalize after the app exits" workflows. An Operator solves a fundamentally different problem (cluster‑level orchestration of many pods or external systems) and would add weeks of learning, a controller deployment, RBAC, CRD schemas, and a reconciliation loop you don't need.

The rest of this report explains why, with the mechanics, YAML, comparison matrix, and the failure modes you should plan around.

---

## 1. Sidecar Container Fundamentals

A **sidecar container** is a secondary container that runs in the same Pod as your main application container. Because they share the Pod, sidecars and the main container share:

- **The same network namespace** — they can talk to each other over `localhost`.
- **The same node and lifecycle boundary** — they're scheduled together; if the Pod dies, they all die.
- **Volumes you explicitly mount into both** — typically an `emptyDir` for ephemeral shared filesystem, or a PVC for persistence.

They do **not** share filesystems, environment variables, or process trees by default; you have to opt in via `volumeMounts` or `shareProcessNamespace: true`.

Historically, "sidecar" was just a naming convention: a regular extra container in `spec.containers`. This pattern had two well‑known problems for batch‑style workloads: (1) sidecars could start *after* the main container, causing race conditions, and (2) sidecars could prevent a Job pod from completing because they kept running after the main container exited.

**Kubernetes 1.28 introduced "native sidecars"** (alpha), graduated to beta and on‑by‑default in 1.29, and reached **GA in Kubernetes 1.33**. The mechanism is deliberately minimal: a container is listed under `spec.initContainers` *but* has `restartPolicy: Always`. The kubelet then treats it specially:

| Property | Regular container | Regular init container | Native sidecar (`initContainer` + `restartPolicy: Always`) |
|---|---|---|---|
| Starts before main containers | No (parallel) | Yes (sequentially, must finish first) | Yes (starts in init order, but doesn't block) |
| Runs alongside main | Yes | No (already exited) | Yes |
| Blocks Pod completion in a Job | Yes (the classic problem) | N/A | **No** — Pod completes when main containers finish |
| Restart on crash | Per Pod `restartPolicy` | No | Always (independent of Pod policy) |
| Supports probes (liveness/readiness/startup) | Yes | No | Yes |
| Supports `lifecycle.preStop` / `postStart` | Yes | No | Yes |
| Termination order | Parallel with main | N/A | After all main containers exit, in **reverse start order** |
| OOM kill priority | Normal | Normal | Adjusted to match or be lower priority than main (less likely to be OOM‑killed) |

The "next init container starts as soon as the sidecar is *started* (not exited)" rule, combined with optional `startupProbe`, is what makes native sidecars usable as a pre‑flight readiness gate without ever exiting.

---

## 2. The Git Init/Finalization Use Case

Your use case decomposes naturally into three phases, all expressible with one Pod spec:

1. **Pre‑application setup**: `git clone` the repo (and any dependencies) into a shared volume so the main agent can read it.
2. **Main work**: the agent runs against the cloned working copy and writes back to it.
3. **Post‑application cleanup**: when the agent is done (or the Pod is being terminated), `git add`/`git commit`/`git push` the changes.

There are three reasonable layouts for this:

### Layout A — Init container for clone, sidecar (or no sidecar) for push

The simplest and most idiomatic. A regular `initContainer` runs `git clone`, then exits. The main agent runs. A native sidecar with a `preStop` hook (or a SIGTERM trap) runs `git push` on shutdown. This is the layout I recommend for your scenario; the YAML is in §10.

### Layout B — Single sidecar that does both clone and push

The sidecar starts first (because it's a native sidecar in `initContainers`), does `git clone`, signals readiness via a `startupProbe` or by writing a marker file, then sleeps. On termination, its `preStop` hook (or SIGTERM trap) runs the commit/push. The main agent only starts once the sidecar's startup probe passes.

### Layout C — `git-sync` (pull‑only) sidecar + custom push hook

The Kubernetes project's `kubernetes/git-sync` image is the canonical sidecar for keeping a directory synchronized with a Git remote. It's robust (atomic symlink swaps, supports SSH and HTTPS auth, depth‑1 clones, periodic re‑sync) but **it only pulls — it does not push**. So git‑sync is ideal if the main container only consumes code, but for your write‑back use case you need a custom finalizer container or a small wrapper image (alpine/git or `bitnami/git`) doing `git commit && git push`.

### How a sidecar detects pod termination

A native sidecar gets *three* signals, in this order, when the Pod begins terminating (per KEP‑753 and the Kubernetes docs):

1. **`preStop` hook fires** at the *start* of the termination grace period, simultaneously with the main containers' preStop hooks. The grace period clock starts here.
2. **SIGTERM is sent to all main containers**. The sidecar is *not* SIGTERMed yet. It keeps running.
3. **Once all main containers have exited**, the kubelet sends SIGTERM to sidecars in **reverse order of their startup** (LIFO). If grace period expires before sidecars exit, they get SIGKILL after a fixed 2‑second additional grace.

This ordering is the key reason native sidecars are the right tool for your scenario: the sidecar is *guaranteed* to outlive the main agent, which means it can observe "the main work is done" and *then* push. You have two main detection mechanisms inside the sidecar:

- **`preStop` hook**: a `lifecycle.preStop.exec` command runs synchronously as soon as the Pod enters Terminating state. Useful for "the user clicked stop on the orchestrator." Caveat: it fires *before* the main container has finished, so if you push from `preStop` you may push an unfinished working tree.
- **SIGTERM trap inside the sidecar process**: write the sidecar entrypoint as a shell script (or any program) that does `trap 'do_git_push' TERM` and then `wait`. Because SIGTERM only arrives at the sidecar *after* the main container has fully exited, this is the cleanest way to "commit and push exactly the final state."

In practice, the most reliable pattern is the SIGTERM trap, paired with a generous `terminationGracePeriodSeconds` so the push has time to finish over a slow network.

---

## 3. Init Containers vs. Regular Sidecars: When to Use Which

| Concern | Regular init container | Native sidecar |
|---|---|---|
| One‑time setup that must finish before main starts | ✅ Best fit (clone, schema migration, fetch artifacts, wait for DB) | Possible, but more moving parts |
| Long‑running auxiliary process during main lifetime | ❌ Cannot — exits before main starts | ✅ Designed for this (proxies, log shippers, secret refreshers) |
| Needs to push/commit at end of run | ❌ Already exited; no termination hook | ✅ Receives termination signal after main exits |
| Needs probes | ❌ No probes | ✅ liveness/readiness/startup probes |
| Needs network communication with the main app | ❌ Main app isn't running yet | ✅ Both up at the same time on `localhost` |

**Rule of thumb:** if the work is "do X then exit," it's an init container. If the work is "be available while main runs, then clean up," it's a native sidecar. For a clone + push workflow, the cleanest decomposition is `initContainer: git-clone` (because clone has to finish before main starts and there's no value in keeping it alive) plus a small `sidecar: git-push` that does nothing during main execution and runs only on termination. You can also collapse both into a single sidecar if you want fewer containers.

---

## 4. Termination Handling: How Reliable Is It?

The mechanics are well‑defined but full of subtle traps. The relevant settings:

- **`terminationGracePeriodSeconds`** (Pod‑level, default 30s): the total budget from the moment the Pod enters Terminating until the kubelet force‑kills with SIGKILL. This budget *includes* the time spent in `preStop` hooks. If your preStop sleeps 25s and your container then needs 10s to drain, with the default 30s grace period you'll be SIGKILLed mid‑drain.
- **`lifecycle.preStop`**: an `exec`, `httpGet`, or (Kubernetes 1.30+) native `sleep` action. It blocks SIGTERM delivery until it returns. Hooks failing or hanging cause the container to be killed when the grace period expires.
- **SIGTERM/SIGKILL**: SIGTERM is delivered to PID 1 in the container. SIGKILL is unblockable.

### Pitfalls and mitigations

1. **PID 1 swallows SIGTERM.** If your container `ENTRYPOINT` is `/bin/sh -c "myapp ..."`, then `/bin/sh` is PID 1 and shells do *not* forward signals to children by default. Your `myapp` never sees SIGTERM. **Fix:** use `exec myapp ...` in the entrypoint, or use a tiny init like `tini`, or set `command:` to the binary directly.
2. **Distroless images don't have `/bin/sh` or `sleep`.** A `preStop` exec command using `sleep` will fail with `FailedPreStopHook`. Use Kubernetes 1.30+ native `lifecycle.preStop.sleep.seconds: 15` instead, or add a busybox stage to your image.
3. **The grace period is shared.** `terminationGracePeriodSeconds` covers preStop *plus* SIGTERM handling. Add them up and add slack.
4. **Sidecars that wrap a binary in a shell script lose signals** — the same PID‑1 problem. Use `exec` in entrypoints.
5. **For sidecars, the PreStop hook fires at the start of termination, not after main exits.** If you want "push only after main has finished its work," a SIGTERM trap is more accurate than `preStop`, because SIGTERM to the sidecar arrives only after main containers have terminated. Use a small entrypoint like:
   ```sh
   #!/bin/sh
   trap 'cd /work && git add -A && git commit -m "auto" && git push; exit 0' TERM
   # idle until SIGTERM
   while true; do sleep 3600 & wait $!; done
   ```
6. **Sidecar exit code 0 is not guaranteed at Pod end.** The Kubernetes docs explicitly state: "When other containers take all allotted graceful termination time, the sidecar containers will receive SIGTERM, followed by SIGKILL, before they have time to terminate gracefully. So exit codes different from 0 for sidecar containers are normal on Pod termination and should be generally ignored." You must size the grace period generously (e.g., 120–300 seconds for a network push over a slow link) and you should make the push **idempotent** so a retry on the next run recovers from a partial finalization.
7. **Pod deletion vs. node failure.** Termination hooks run only when the kubelet is alive on the node and is told to terminate. If the node dies hard, no hook runs and no push happens — the in‑progress work is lost. This is a fundamental constraint of any in‑pod cleanup mechanism, sidecar or otherwise. The only way to recover from node loss is an external controller (an Operator) that detects the lost pod and re‑drives the work — which is precisely the Operator's value proposition.

**Bottom line on reliability:** for graceful terminations (orchestrator stop, rolling update, normal Job completion), the sidecar pattern with a SIGTERM trap and a generous `terminationGracePeriodSeconds` is reliable enough for nearly all developer‑tooling and CI workloads. For hard node failure, you need either an Operator that re‑drives work or accept that the last unsaved state is lost.

---

## 5. Git Operations from a Sidecar: Practical Concerns

### Sharing the working tree

The main container and the sidecar(s) share files via a volume mounted into both. For an ephemeral session (your case), `emptyDir` is enough; for survival across pod restarts, a PVC. This is exactly how Tekton's `git-clone` task and JupyterHub's `git-sync` deployments work — a `volume: emptyDir{}` is mounted at the same path (e.g., `/workspace/source`) in both containers. The init container clones into `/workspace/source/<repo>`, the agent reads/writes there, and the finalizer sidecar pushes from there.

A subtlety: **filesystem permissions**. Git‑sync recommends setting `securityContext.fsGroup` (e.g., `65533`) on the Pod so all containers in the Pod can read/write the shared volume regardless of their user IDs. Without `fsGroup`, the agent (often running as a different UID) may not be able to modify files the clone container created.

### Authentication patterns

Three common patterns, in roughly increasing security:

1. **HTTPS with a Personal Access Token in a Secret.** Mount the secret as a file or env var, configure git via a credential helper or a `https://x-access-token:${TOKEN}@github.com/...` URL. Simple to implement; tokens must be rotated. Tekton's `git-clone` task uses this via the `basic-auth` workspace (a `.gitconfig` + `.git-credentials` file).
2. **SSH key in a Secret with `defaultMode: 0400`.** Mount at `/etc/git-secret` or `/.ssh/`, set `fsGroup` so the key is readable, configure `GIT_SSH_COMMAND` or `~/.ssh/config`. The `kubernetes/git-sync` README has a full worked example.
3. **GitHub App / short‑lived OIDC tokens.** `git-sync` v4 supports GitHub App auth (`--github-app-application-id`, `--github-app-client-id`, etc.); cloud providers like GCP/AWS can issue short‑lived federated tokens. Best practice for production but more setup.

For minimal learning curve, pattern 1 (PAT in a Secret) is fine.

### Committing and pushing

The mechanics inside the sidecar:

```sh
git -C /workspace/source/repo config user.email "agent@example.com"
git -C /workspace/source/repo config user.name "agent"
git -C /workspace/source/repo add -A
git -C /workspace/source/repo commit -m "session $SESSION_ID changes" || true   # no-op if nothing changed
git -C /workspace/source/repo push origin "$BRANCH"
```

The `|| true` on commit handles the "nothing changed" case so the sidecar doesn't exit non‑zero. Wrap the whole block in a function and call it from the SIGTERM trap. Image: `alpine/git` (~25 MB) is sufficient.

### Limitations of `git-sync` for this use case

`kubernetes/git-sync` is a sidecar designed for the *pull* direction. Its primary use cases are config sync (push to git, pulled into running pods) and serving static content. It does not push. For your write‑back scenario, you need either (a) a thin custom sidecar image that wraps `git`, or (b) build your own using `git-sync` to clone and a shell script for the push leg.

---

## 6. The Custom Operator (CRD) Approach

A custom `CodeSession` CRD + Operator would model the workflow at the cluster level. You'd run a controller (a Deployment) that watches `CodeSession` objects. When a user creates one, the controller creates a Pod (or Job) wired up with the right volume, secret, and image. When the `CodeSession` is deleted (or its `.spec.terminating` flag is flipped), the controller orchestrates cleanup. A minimal CRD might look like:

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: codesessions.dev.example.com
spec:
  group: dev.example.com
  names:
    kind: CodeSession
    plural: codesessions
  scope: Namespaced
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                repoURL:    { type: string }
                branch:     { type: string }
                image:      { type: string }
                pushOnDelete: { type: boolean }
            status:
              type: object
              properties:
                phase: { type: string }   # Cloning, Running, Pushing, Done, Failed
                lastCommit: { type: string }
```

The controller's reconciliation loop would:
1. On create: ensure a Pod exists with an init container for clone and the user image as main.
2. On running: update `.status.phase` to `Running`.
3. On user delete or completion: trigger a finalizer that runs a Job to commit/push, set status, then remove the finalizer so the resource is garbage‑collected.
4. On failure (including node failure): re‑reconcile, possibly retry the push from a snapshot or re‑schedule on a healthy node.

### What an Operator buys you

- **Cluster‑level state and observability**: `kubectl get codesessions` shows all sessions; status reflects phase. With sidecars alone, you have to inspect each Pod individually.
- **Recovery from node failure**: a controller can detect that a Pod was lost mid‑session and re‑drive the work from external storage (e.g., a snapshot pushed periodically), something a sidecar cannot do because it dies with its Pod.
- **Cross‑pod coordination**: e.g., quotas across all sessions for a user, capacity gating, scheduling onto specific node pools.
- **Validation and defaulting via admission webhooks**: enforce that `repoURL` is on the allow‑list, default the branch, etc.
- **Decoupled UX**: the user (or your front‑end) only needs to create/delete a small custom resource; the messy Pod spec is the controller's problem.
- **Finalizers**: the Kubernetes finalizer mechanism guarantees the controller runs cleanup before the CR is deleted, even if the user `kubectl delete`s it.

### What an Operator costs you

- **A whole new component to deploy and operate** (the controller Deployment), plus its RBAC `ClusterRole`, `ServiceAccount`, and webhooks if you add validation.
- **A real codebase**, typically Go with controller‑runtime (Kubebuilder or Operator SDK). Even a "trivial" operator is hundreds of lines and requires knowledge of informers, work queues, owner references, and finalizers.
- **CRD lifecycle management**: schema versioning, conversion webhooks if you ever change the schema in incompatible ways, updates rolled out across clusters.
- **Testing**: envtest, integration tests, end‑to‑end on real clusters.
- **Debuggability** is harder: when something goes wrong, you debug the controller logs, then the controller's effect on Pods, then the Pods themselves.

The Kubernetes documentation itself states the principle: "Avoid using a Custom Resource as data storage for application, end user, or monitoring data: architecture designs that store application data within the Kubernetes API typically represent a design that is too closely coupled."

### When is an Operator justified?

The CNCF Operator White Paper, the Kubernetes "Custom Resources" doc, and Bilgin Ibryam's *Kubernetes Patterns* all converge on roughly the same criteria. Build an Operator when several of these are true:

- You're managing a **stateful** application whose lifecycle is non‑trivial (e.g., backups, failover, version upgrades that require coordinated steps across multiple pods, like Vault, etcd, Kafka).
- You need **cluster‑wide coordination** that one Pod can't see (quotas, scheduling, leader election among many pods).
- You expect operational logic to be **shared across many teams or clusters** — packaging it as a controller pays back the upfront cost.
- You need to **survive node failure** with automatic reconciliation, not just graceful shutdown.
- The number of distinct CR instances is **large and dynamic** and must be modeled as first‑class API objects.

Examples in the wild that fit: Jaeger Operator, Percona MongoDB Operator, Vault Secrets Operator, ArgoCD's `Application` controller, Tekton's `PipelineRun` controller. Each of these owns a complex cluster‑level concern.

For "clone a repo, run an agent, push on exit," **none of these criteria apply**. It is a per‑pod concern with a graceful happy path. An Operator would be ~500–1500 lines of Go and a controller deployment to do what a 30‑line Pod spec already does.

---

## 7. Learning Curve and Operational Burden

| Dimension | Sidecar pattern | Custom CRD + Operator |
|---|---|---|
| Concepts to learn | Pod, container, volume, `initContainers`, `lifecycle.preStop`, `terminationGracePeriodSeconds`, signal handling | All of the sidecar concepts **plus**: CRDs, OpenAPI schema, controller‑runtime, informers, work queues, reconcile loops, owner references, finalizers, RBAC, admission webhooks, leader election |
| Time to first working version (novice) | Hours | Days to weeks (or longer if you've never written Go) |
| Code to write | Zero (or a tiny entrypoint script) | Hundreds to low thousands of lines of Go |
| Components to deploy | Just your Pod | Controller Deployment, CRDs, RBAC, optionally cert‑manager + webhook configs |
| Debugging | `kubectl describe pod`, `kubectl logs <pod> -c <container>`, `kubectl exec` | The above **plus** controller logs, controller metrics, reconcile traces, CR status fields, finalizer state |
| Idiomatic in production | Yes — used by Istio, Linkerd, Vault, JupyterHub, Tekton, ArgoCD, every major service mesh, and effectively all Kubernetes logging/metrics agents | Yes for *complex stateful systems*; overkill for per‑pod concerns |
| Failure modes you must handle | Signal handling, grace period, volume permissions, image bloat | All sidecar failure modes **plus**: controller crash, leader‑election bugs, stale informer cache, finalizer deadlocks, CRD schema drift, RBAC drift |
| Upgrade story | Update the Pod template | Update the CRD (with conversion if schema changed), update the controller Deployment, ensure backward compatibility of in‑flight CRs |

For a Kubernetes novice, the sidecar pattern is approximately one order of magnitude less work to learn, build, deploy, and debug. The Operator pays back its overhead only when the problem genuinely requires cluster‑level coordination.

---

## 8. Real‑World Examples

### Sidecars doing git operations (developer tooling / CI/CD)

- **`kubernetes/git-sync`** (CNCF / Kubernetes SIG): the canonical reference sidecar for one‑way git → filesystem sync. Used by JupyterHub, Argo CD's repo‑server (philosophically similar), config‑sync, and many internal "GitOps from pull" patterns. Pulls only; uses an `emptyDir` shared volume and an atomic symlink swap to publish updates without consumers seeing partial state.
- **JupyterHub + nbgitpuller**: the JupyterHub project ships `nbgitpuller`, a Jupyter server extension (not a sidecar in this case, but the pattern is the same — git pull into a per‑user volume on session start). For shared environments, JupyterHub deployments often combine this with a `git-sync` sidecar pulling course materials into a shared read‑only volume.
- **Tekton `git-clone` task**: arguably the closest analogue to your scenario. Tekton's `git-clone` is a `Task` (a Kubernetes‑native CRD provided by the Tekton operator) whose Pod uses a Tekton‑provided init image to clone into a `Workspace` (= a shared volume mounted into other Tasks' Pods). Subsequent steps in the same `Pipeline` read and modify the workspace, and the pipeline can include a final `git-cli` task that pushes back. Tekton supports per‑step and per‑sidecar workspace isolation via `workspaces:` declarations on individual `steps` or `sidecars` blocks, so credentials are only mounted into the steps that need them. This is exactly your "clone, modify, push" workflow, expressed as Tekton primitives.
- **ArgoCD**: itself is an Operator (it has CRDs `Application` and `AppProject` with controllers). But the pattern for *ingesting* git into runtime is still a sidecar/init‑container pattern in the `repo-server` component.
- **Vault Agent Injector**: classic sidecar pattern used as comparison in HashiCorp's docs to the Vault Operator (`Vault Secrets Operator`). HashiCorp's own writeup contrasts the two: sidecar for per‑pod secret rendering, Operator for cluster‑wide CRD‑driven secret synchronization. The same dichotomy applies to your problem.

### Operators managing Pod lifecycle

- **Tekton Pipelines controller**: watches `TaskRun` and `PipelineRun` CRs and creates/manages the underlying Pods, including injecting init containers for credentials and sidecars for parameter substitution. This is genuinely an Operator‑sized concern (DAG scheduling across many Pods, status aggregation, retries).
- **Argo Workflows controller**: similar, watches `Workflow` CRs.
- **JupyterHub** (specifically the `KubeSpawner`): a hybrid. The Hub itself is a regular service (not a CRD‑based Operator), but it programmatically creates per‑user notebook Pods. Functionally it behaves like an operator for "Notebook" objects. If you wanted, you could re‑model your `CodeSession` use case after KubeSpawner: a single service application that creates Pods on demand, without ever defining a CRD.
- **Jaeger Operator**: watches `Jaeger` CRs and creates Deployments + sidecar injection webhooks for the application Pods. A classic example of where the Operator pattern earns its keep.

A telling real‑world data point from the Jaeger docs: even with an Operator, the *actual instrumentation* of application Pods is done by injecting a **sidecar** (`jaeger-agent`). The Operator and the sidecar are complementary, not alternatives. For your use case, the Operator layer simply isn't needed.

---

## 9. Side‑by‑Side Comparison Matrix

| Criterion | Sidecar pattern (native sidecar in 1.29+) | Custom CRD + Operator |
|---|---|---|
| **Right level of abstraction for "per‑pod init/finalize"** | ✅ Native fit | ⚠️ Overkill |
| **Right level for "cluster‑wide stateful orchestration"** | ❌ Limited | ✅ Native fit |
| **Learning curve (novice)** | Low (Pod spec + signal handling) | High (Go controller + Kubernetes API extension model) |
| **Lines of code to maintain** | ~0 (just YAML) | Hundreds to thousands |
| **Components to deploy and operate** | 0 extra (just Pods) | 1+ (controller, CRDs, RBAC, optional webhooks) |
| **Debug surface** | `kubectl logs`, `kubectl describe pod` | Adds controller logs, CR status, reconcile traces |
| **Latency / overhead** | One extra container per Pod | One extra Pod cluster‑wide + per‑Pod sidecars too |
| **Init guarantees (run before main)** | ✅ via initContainers / native sidecar startup ordering | Same plus possible pre‑pod logic in controller |
| **Finalize guarantees (run after main exits, before pod gone)** | ✅ via SIGTERM ordering on native sidecars + preStop | ✅ via CR finalizers (stronger — survive controller restart) |
| **Survives node failure?** | ❌ Pod and sidecar die together; in‑flight state may be lost unless externalized | ✅ Controller can re‑drive on a new node (if state is externalized) |
| **Cross‑pod coordination** | ❌ | ✅ |
| **Idiomatic for git‑backed dev/CI workloads** | ✅ (Tekton, ArgoCD repo‑server, git‑sync, JupyterHub) | ⚠️ Only for the orchestration layer (Tekton, Argo Workflows), not the per‑session work |
| **`kubectl get` surface** | `kubectl get pods` | `kubectl get codesessions` (nicer UX, but you must build it) |
| **Validation/admission** | None (or via generic policies like Kyverno/OPA) | Built‑in OpenAPI schema + optional webhooks |
| **Versioning / API evolution** | None — Pod spec is K8s‑versioned | You own the CRD versioning forever |
| **Observability** | Pod events + container logs | Adds CR status conditions and controller metrics |
| **Failure recovery** | Manual / re‑run | Reconciliation loop (automatic) |
| **Time to first working prototype** | Hours | Days to weeks |
| **Risk of getting it subtly wrong** | Moderate (signal handling, grace period sizing, PID 1) | High (controller correctness, race conditions, finalizer bugs) |

---

## 10. Concrete YAML — Both Approaches

### Sidecar approach (recommended for your scenario)

This is a complete, runnable example for Kubernetes 1.29+. It uses a native sidecar (init container with `restartPolicy: Always`) to do the git push on termination, and a regular init container to do the initial clone. Replace placeholders.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: git-creds
type: Opaque
stringData:
  # PAT or app token; for SSH, use an `id_rsa` key + known_hosts and mount as a volume
  token: "github_pat_xxxxxxxxxxxxxxxxxxxx"
---
apiVersion: v1
kind: Pod
metadata:
  name: code-session-demo
spec:
  terminationGracePeriodSeconds: 180   # generous: cover a slow git push over a flaky network
  securityContext:
    fsGroup: 65533                     # so all containers can rw the shared volume
  volumes:
    - name: workspace
      emptyDir: {}
    - name: git-creds
      secret:
        secretName: git-creds
  initContainers:

    # 1) One-shot clone before the agent starts.
    - name: git-clone
      image: alpine/git:2.45.2
      env:
        - name: REPO
          value: "https://github.com/your-org/your-repo.git"
        - name: BRANCH
          value: "main"
        - name: GIT_TOKEN
          valueFrom: { secretKeyRef: { name: git-creds, key: token } }
      command: ["/bin/sh", "-c"]
      args:
        - |
          set -eu
          # Embed the token in the URL just for the clone; remove it after.
          AUTH_URL=$(echo "$REPO" | sed -e "s#https://#https://x-access-token:${GIT_TOKEN}@#")
          git clone --branch "$BRANCH" "$AUTH_URL" /workspace/repo
          # Replace remote with token-less URL so the working copy on disk has no secret.
          git -C /workspace/repo remote set-url origin "$REPO"
          git -C /workspace/repo config user.email "agent@example.com"
          git -C /workspace/repo config user.name  "code-session-agent"
      volumeMounts:
        - { name: workspace, mountPath: /workspace }

    # 2) Native sidecar: idle until SIGTERM, then commit & push.
    #    Kubernetes 1.29+: init container with restartPolicy: Always == sidecar.
    - name: git-finalizer
      image: alpine/git:2.45.2
      restartPolicy: Always
      env:
        - name: BRANCH
          value: "main"
        - name: GIT_TOKEN
          valueFrom: { secretKeyRef: { name: git-creds, key: token } }
      command: ["/bin/sh", "-c"]
      args:
        - |
          set -u
          finalize() {
            cd /workspace/repo || exit 0
            git add -A
            # If nothing changed, commit returns non-zero; treat as success.
            git commit -m "session $(hostname) $(date -Iseconds)" || true
            # Inject token only at push time so it never sits in the working tree.
            AUTH_URL=$(git remote get-url origin | sed -e "s#https://#https://x-access-token:${GIT_TOKEN}@#")
            git push "$AUTH_URL" "HEAD:$BRANCH"
          }
          trap 'finalize; exit 0' TERM INT
          # Idle. The `& wait` idiom makes the shell responsive to signals.
          while true; do sleep 3600 & wait $!; done
      volumeMounts:
        - { name: workspace, mountPath: /workspace }

      # Optional: a startup probe so the sidecar is "ready" only after clone is done.
      # (Not strictly needed here because the regular init container already gates main.)
      startupProbe:
        exec:
          command: ["/bin/sh", "-c", "test -d /workspace/repo/.git"]
        periodSeconds: 2
        failureThreshold: 30

  containers:

    # 3) Your agent. It sees the cloned repo at /workspace/repo and writes back to it.
    - name: agent
      image: your-org/code-agent:1.0
      workingDir: /workspace/repo
      volumeMounts:
        - { name: workspace, mountPath: /workspace }
      # Optional: a preStop hook on the agent to flush any pending work to disk
      # before SIGTERM hits. Keep it well under terminationGracePeriodSeconds.
      lifecycle:
        preStop:
          exec:
            command: ["/bin/sh", "-c", "sync; sleep 2"]
```

Key points:

- The `git-clone` regular init container blocks main from starting, so the agent never sees a missing repo.
- The `git-finalizer` is a native sidecar: it starts during the init phase, the next init container (none here) and main containers wait for its `startupProbe` to pass, and it stays running for the Pod's lifetime.
- When the Pod is terminated, the agent gets SIGTERM and exits. *Then* the kubelet sends SIGTERM to `git-finalizer`. The trap fires `finalize`, which commits and pushes. The Pod then completes.
- `terminationGracePeriodSeconds: 180` gives the push a budget. Tune to your network.
- Token never lands in `.git/config` (`remote set-url` uses the bare URL); it's only injected at push time via a temporary URL. For higher security, use SSH keys instead.

### Operator approach (for comparison only)

Even a *minimal* operator is more code than fits cleanly in a report. Here's the user‑facing CR a `CodeSession` operator would expose:

```yaml
apiVersion: dev.example.com/v1
kind: CodeSession
metadata:
  name: alice-session-42
spec:
  repoURL: https://github.com/your-org/your-repo.git
  branch:  main
  image:   your-org/code-agent:1.0
  pushOnDelete: true
  authSecretRef:
    name: alice-git-creds
    key:  token
```

Behind the scenes, the controller (a Go program using `controller-runtime`) would:

1. Watch `CodeSession` create/update events.
2. Materialize a Pod that looks structurally similar to the sidecar YAML above.
3. Set an owner reference so the Pod is GC'd if the CR is deleted.
4. Add a finalizer (`dev.example.com/git-push-on-delete`) to the CR so that on deletion, the controller can run a Job to push *after* the Pod has gone (or block deletion until push completes).
5. Surface status (`Cloning` → `Running` → `Pushing` → `Done` / `Failed`) on `.status.conditions`.
6. Optionally re‑schedule on node failure by detecting the Pod loss and creating a new Pod from the last known commit (which requires periodic snapshot pushes — the sidecar can't do this without extra logic anyway).

The "minimal" Go skeleton for this controller is on the order of 200–400 lines, plus a Dockerfile, RBAC manifests, a CRD manifest, and a Deployment for the controller itself. Every additional feature (validation webhooks, metrics, leader election, multi‑version CRDs, conversion webhooks) adds more.

---

## 11. Recommendation for Your Specific Scenario

Your stated requirements are: **orchestrator‑driven init, git push by sidecar on termination, minimal learning curve.** Mapping these to the comparison:

- **Orchestrator‑driven init**: an external system (your orchestrator) creates a Pod when a session starts. The Pod itself doesn't need cluster‑level orchestration logic — that's already provided by the orchestrator. ✅ Sidecar fits; Operator duplicates the orchestrator.
- **Git push by sidecar on termination**: the literal feature you want is what native sidecars + SIGTERM trap (or `preStop`) were designed for. ✅ Sidecar.
- **Minimal learning curve**: writing a Pod spec is approximately a 1‑day investment. Writing an Operator is 2–6 weeks plus ongoing maintenance. ✅ Sidecar by an order of magnitude.

**Pick the native sidecar pattern.** Specifically:

1. Use a regular `initContainer` (no `restartPolicy`) for `git clone`. It exits before main starts. Failures here block the Pod from running, which is the right behavior.
2. Use a native sidecar (an `initContainer` with `restartPolicy: Always`) running a tiny `alpine/git` image with a SIGTERM trap that does `git add && git commit && git push`. Place it after the clone init container in the spec.
3. Set `terminationGracePeriodSeconds` to a generous value (120–300 s) and ensure the sidecar's entrypoint is signal‑clean (no `/bin/sh -c "long-script"` wrapping; use `exec` or set `command:` directly so PID 1 actually receives signals).
4. Mount an `emptyDir` volume into both the clone init container, the agent main container, and the finalizer sidecar at the same path (e.g., `/workspace/repo`). Set `securityContext.fsGroup` so all containers can write it.
5. Store credentials in a Kubernetes Secret. Inject the token only into the Git URL at clone/push time so it never lives on disk in `.git/config`. For higher security, use SSH keys with an SSH `Secret` and `defaultMode: 0400`.
6. **Require Kubernetes 1.29 or later** (or 1.28 with the `SidecarContainers` feature gate enabled). On 1.33+ the feature is GA and on by default. If you must support older clusters, fall back to the legacy pattern of a regular `containers:` entry plus a shared "I'm done" marker file the sidecar polls.
7. Make the push **idempotent**: a session that fails halfway should leave the remote in a recoverable state, and the next push should converge. Use `git commit --allow-empty || true` semantics so transient "nothing to commit" doesn't fail the sidecar.

**When you would later upgrade to an Operator**: only when you start needing cluster‑wide concerns the sidecar can't address — for example, "when a node dies mid‑session, automatically resurrect the session on a new node from the last committed snapshot," or "enforce a per‑user quota of concurrent sessions across the cluster," or "give users a friendly `kubectl get codesessions` view with rich status." If those needs arrive, the sidecar pattern you build now becomes the *implementation detail* of the Operator's reconciler — you don't throw it away, you wrap it. That's exactly how Tekton, Argo, JupyterHub's KubeSpawner, and the Jaeger Operator are built: a controller on top, sidecars and init containers underneath.

Start with sidecars. You'll be in production in days, not months, and you'll have learned the primitives an Operator would have hidden from you anyway.