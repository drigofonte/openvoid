---
date: 2026-05-02
topic: working-with-clusters
audience: novice contributor (Docker comfortable, K8s new)
phases-covered: 0, 1, 2
---

# Working with openvoid's Kubernetes setup

A practical guide. After Phases 0, 1, and 2 you have a working local cluster, a remote cluster you can spin up on demand, and a hello-world Pod running on the local one. This doc explains what each piece does, how to use them in your daily flow, and how to reflect changes between local and remote.

It assumes you're comfortable with Docker but new to Kubernetes. It does not pretend to teach you all of Kubernetes — only the parts you'll touch before Phase 3 (which introduces Tilt and largely automates this loop).

---

## 1. Mental model

```
                         your laptop
   ┌──────────────────────────────────────────────────────────────┐
   │                                                              │
   │                    Docker Engine (host)                      │
   │   ┌────────────────────────────┐    ┌──────────────────────┐ │
   │   │   container "kind-registry"│    │ container            │ │
   │   │   image: registry:2        │    │   "openvoid-local-   │ │
   │   │   port :5001 → :5000       │    │    control-plane"    │ │
   │   │                            │    │   image: kindest/    │ │
   │   │   stores image blobs       │    │     node:v1.35       │ │
   │   └────────────┬───────────────┘    │                      │ │
   │                │                    │ ┌──────────────────┐ │ │
   │                │ docker network     │ │ containerd       │ │ │
   │                │ "kind"             │ │ ┌──────────────┐ │ │ │
   │                └────────────────────┼─┼─┤ Pod: nginx   │ │ │ │
   │                                     │ │ └──────────────┘ │ │ │
   │                                     │ └──────────────────┘ │ │
   │                                     └──────────────────────┘ │
   │                                                              │
   │   kubectl ──► kube-apiserver (inside the kind node) ──► …    │
   │                                                              │
   └──────────────────────────────────────────────────────────────┘
                                   │
                                   │  (only when you spin up DOKS)
                                   ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  DigitalOcean — managed Kubernetes cluster (DOKS)            │
   │   "do-nyc1-openvoid-dev"                                     │
   │   1× s-2vcpu-4gb worker (~$24/mo while running)              │
   │   billed by the second from `doks-create.sh` to `destroy`    │
   └──────────────────────────────────────────────────────────────┘
```

The pieces that matter:

- **Docker Engine** — runs on your host (Docker Desktop on macOS, or a service on Linux). Same Docker you already know.
- **kind** ("Kubernetes IN Docker") — runs Kubernetes node(s) as Docker containers. One kind node = one big Docker container with `containerd` + the K8s control plane inside it. Pods run *inside* that container, managed by containerd. From your perspective, the kind node is a black box you talk to via `kubectl`.
- **Pods** — the smallest deployable unit in Kubernetes. A Pod wraps one or more containers and a shared network namespace. The hello-world Pod we deployed in Phase 2 is just `nginx:alpine` running inside a Pod.
- **The local registry** — a separate `registry:2` Docker container, accessible at `localhost:5001` from your host. We need it because kind nodes can't reach images you build with `docker build` on your host. Push to `localhost:5001`, kind nodes pull over the `kind` Docker network.
- **kubectl** — the CLI for talking to a Kubernetes cluster's API server. It reads its config (which cluster, which namespace) from `~/.kube/config`.
- **kubectl context** — a named pointer to *which cluster* `kubectl` should talk to. You have two: `kind-openvoid-local` (laptop) and `do-nyc1-openvoid-dev` (DigitalOcean — only present when DOKS is running). The current context is what makes "list pods" mean "list local pods" or "list cloud pods".

The ten Kubernetes terms you'll meet most often, in plain English:

| Term | What it is in one sentence |
|---|---|
| **Cluster** | A set of nodes running Kubernetes. kind = 1-node cluster on your laptop. DOKS = 1-node cluster on DigitalOcean. |
| **Node** | A machine (or container, in kind's case) that runs Pods. |
| **Namespace** | A scope/folder for grouping objects in a cluster. We use `openvoid-system` for our infra. |
| **Pod** | A running instance of one or more containers, the smallest scheduled unit. |
| **Deployment** | A controller that says "I want N copies of this Pod template, keep them healthy." Replaces unhealthy Pods. |
| **ReplicaSet** | The thing a Deployment manages — tracks the actual N copies. You rarely manipulate it directly. |
| **Service** | A stable network endpoint that load-balances traffic to a set of Pods (selected by label). |
| **ConfigMap / Secret** | Bag of key/values — readable by Pods. Secret is base64-encoded and stored slightly differently; not magically encrypted. |
| **PersistentVolumeClaim (PVC)** | "I want N GiB of disk" — Kubernetes provisions actual storage. We use PVCs starting Phase 7. |
| **CustomResourceDefinition (CRD)** | A way to teach Kubernetes about new object types. We define `CodingSession` as a CRD in Phase 4. |

That's enough vocabulary to follow this doc.

---

## 2. The two clusters

| | kind (`kind-openvoid-local`) | DOKS (`do-nyc1-openvoid-dev`) |
|---|---|---|
| Where it runs | Your laptop, in Docker | DigitalOcean managed K8s |
| Cost | $0 | ~$24/mo per node (prorated by the second) |
| Bring up | `bash scripts/kind-up.sh` | `bash infra/remote/doks-create.sh` |
| Tear down | `bash scripts/kind-down.sh` | `bash infra/remote/doks-destroy.sh` |
| Bring-up time | ~30 sec on first run | ~5 min |
| Image source | `localhost:5001` (your local Docker registry) | GHCR (`ghcr.io/openvoid/...`) — only public images for now |
| Live preview routing | `kubectl port-forward` | `cloudflared` tunnel (Phase 9.4) |
| When to use | Daily development, every iteration | Demos, before-you-ship verification |

**Rules of thumb:**

1. Default to kind. It's free and fast.
2. Bring DOKS up only when you specifically need to verify the DOKS path. **Always tear it down between work sessions.**
3. Don't run anything destructive without checking `kubectl config current-context` first. We have `bash scripts/kctx-check.sh` for this.

---

## 3. The kubectl context — knowing which cluster you're talking to

A *context* is `kubectl`'s shorthand for "which cluster, which user, which namespace." Three commands you'll use constantly:

```bash
kubectl config get-contexts            # list every context this kubeconfig knows about
kubectl config current-context         # name of the active one
kubectl config use-context <name>      # switch to a context
```

Equivalent shortcuts with `kubectx` (install via `brew install kubectx`):

```bash
kubectx                                # interactive picker
kubectx kind-openvoid-local            # switch
kubectx -                              # toggle to previous
```

Our convenience script:

```bash
$ bash scripts/kctx-check.sh
context: kind-openvoid-local  (LOCAL)  namespace: default
#                              ↑ green = local, yellow = DOKS, red = unknown
```

Use it as a guard on anything dangerous:

```bash
bash scripts/kctx-check.sh && kubectl delete deployment my-thing -n some-ns
```

If the context isn't what you expect, the second command never runs.

### The namespace gotcha you already hit

We saw this earlier. There are two `kubectl config` flags that look similar but do different things:

```bash
# Switches WHICH cluster — this is what you usually want
kubectl config use-context kind-openvoid-local

# Sets the DEFAULT NAMESPACE on whatever context you're CURRENTLY on
kubectl config set-context --current --namespace=openvoid-system
```

If you accidentally pass a context name to `--namespace=`, your context's default namespace becomes a string that doesn't exist as a real namespace, and `kubectl get pods` (without `-n`) will show nothing on that cluster. Reset with:

```bash
kubectl config set-context kind-openvoid-local --namespace=default
```

Until Phase 5 creates the `openvoid-system` namespace permanently, leave both contexts pinned to `default`.

---

## 4. Bringing things up and down

Each script is idempotent — re-running is a no-op. They check what's already there and skip the steps that don't need to be done.

### Local cluster

```bash
bash scripts/kind-up.sh         # ~30 sec on first run
bash scripts/kind-down.sh       # tear down both cluster + registry
```

What `kind-up.sh` actually does, step by step:

1. **Preflight** — checks `docker`, `kind`, `kubectl` exist and the Docker daemon is reachable. If not, exits with a clear error.
2. **Local registry** — starts a `registry:2` container named `kind-registry`, listening only on `127.0.0.1:5001`. If it's already running, leaves it alone.
3. **kind cluster** — runs `kind create cluster --config infra/local/kind-cluster.yaml` which creates a Docker container named `openvoid-local-control-plane`. If the cluster already exists, leaves it alone.
4. **Node-side registry config** — writes a `hosts.toml` file inside the kind node telling `containerd` to resolve `localhost:5001` to the registry container's address on the kind Docker network. This is what makes `kubectl apply` of a manifest referencing `localhost:5001/foo:latest` actually work.
5. **Network connection** — joins the registry container to the `kind` Docker network so the kind node can reach it.
6. **ConfigMap** — writes a `kube-public/local-registry-hosting` ConfigMap so other tooling (like Tilt later) can discover the registry.
7. **Verify** — waits for all nodes to be `Ready` and confirms the registry responds to `GET /v2/_catalog`.

That's it. The `bash scripts/kind-up.sh` you've been running implements the canonical pattern from <https://kind.sigs.k8s.io/docs/user/local-registry/>.

### Remote cluster

```bash
bash infra/remote/doks-create.sh    # ~5 min, starts billing
bash infra/remote/doks-destroy.sh   # stops billing immediately
```

What `doks-create.sh` does:

1. Checks `doctl` is installed and authenticated (you ran `doctl auth init` once, way back).
2. Refuses to recreate a cluster that already exists (this is a spend guard — it prints how to use the existing one or destroy it).
3. Calls `doctl kubernetes cluster create openvoid-dev --region nyc1 --node-pool size=s-2vcpu-4gb;count=1`.
4. doctl handles kubeconfig automatically — `--update-kubeconfig=true` and `--set-current-context=true` are both default-on, so after this completes your `kubectl` is pointing at DOKS.

Override defaults via env vars:

```bash
OPENVOID_DO_NODE_SIZE=s-2vcpu-8gb bash infra/remote/doks-create.sh   # bigger node
OPENVOID_DO_REGION=lon1 bash infra/remote/doks-create.sh             # different region
OPENVOID_DO_NODE_COUNT=2 bash infra/remote/doks-create.sh            # 2 nodes
```

### Toolchain check

When you suspect something's wrong with your tools (rare):

```bash
bash scripts/check-tools.sh
```

It prints every required CLI, the installed version, the supported floor, and whether each one passed. Optional tools (kubectx, k9s, stern) get an informational note — you can install them or skip them.

---

## 5. Your daily flow (current state, before Phase 3)

Phases 0–2 give you the foundation but no automation yet. Phase 3 introduces **Tilt**, which automates the build → push → apply → restart loop. Until then, your loop is manual.

### Morning

```bash
# 1. Kind up
bash scripts/kind-up.sh

# 2. Confirm context
bash scripts/kctx-check.sh
# Expected: green "kind-openvoid-local (LOCAL)"
```

If you need DOKS for the day's work:

```bash
# 3a. (Optional) Bring DOKS up — only if you need it
bash infra/remote/doks-create.sh
# leaves you on DOKS context. Switch back to kind:
kubectl config use-context kind-openvoid-local
```

### During development

The base loop, before Tilt:

```bash
# Edit something (a manifest, a script, eventually code)
$EDITOR infra/local/hello-world.yaml

# Re-apply
kubectl apply -f infra/local/hello-world.yaml

# Inspect
kubectl get all -n openvoid-system
kubectl describe pod <name> -n openvoid-system
kubectl logs <name> -n openvoid-system

# Test
kubectl port-forward svc/hello-world 8080:80 -n openvoid-system &
curl http://localhost:8080
kill %1   # kill the port-forward when done
```

When Phase 3 lands, `tilt up` will replace this loop entirely for the openvoid services — change a file, Tilt rebuilds the image, pushes to the local registry, and rolls the Pod automatically. You won't run `kubectl apply` by hand for openvoid services again. You will still use `kubectl get` and `kubectl describe` to inspect.

### End of day

```bash
# Kind: optional. Saves laptop RAM if you don't need it overnight.
bash scripts/kind-down.sh

# DOKS: REQUIRED if you brought it up. Stops billing.
bash infra/remote/doks-destroy.sh

# Verify no orphaned cloud resources (LBs, volumes survive cluster delete)
doctl compute load-balancer list   # expect: empty
doctl compute volume list          # expect: empty (or pre-existing volumes you own)
```

The `doctl compute` checks matter: a forgotten LoadBalancer is $12/mo even after the cluster is gone.

---

## 6. A concrete walkthrough — deploying hello-world

Let's run the full Phase 2 demo with explanations of what each command does and why.

### Step 1 — Start clean

```bash
bash scripts/kind-up.sh
bash scripts/kctx-check.sh
# context: kind-openvoid-local  (LOCAL)  namespace: default
```

### Step 2 — Apply the manifest

```bash
kubectl apply -f infra/local/hello-world.yaml
# namespace/openvoid-system created
# deployment.apps/hello-world created
# service/hello-world created
```

`apply` is the do-what-I-mean command: it creates resources that don't exist, updates ones that do, and leaves alone what's unchanged. Re-running `apply` with the same file is safe.

### Step 3 — See what got created

```bash
kubectl get all -n openvoid-system
```

Output:
```
NAME                               READY   STATUS    RESTARTS   AGE
pod/hello-world-7498cc9f6b-gdsqt   1/1     Running   0          5s

NAME                  TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)
service/hello-world   ClusterIP   10.96.175.11   <none>        80/TCP

NAME                          READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/hello-world   1/1     1            1           5s

NAME                                     DESIRED   CURRENT   READY
replicaset.apps/hello-world-7498cc9f6b   1         1         1
```

Note the names:

- `pod/hello-world-7498cc9f6b-gdsqt` — the actual running container. Name is `<deployment>-<replicaset-hash>-<pod-hash>`.
- `replicaset.apps/hello-world-7498cc9f6b` — the controller managing the Pod. You almost never interact with the ReplicaSet directly.
- `deployment.apps/hello-world` — the thing you applied.
- `service/hello-world` — the network endpoint.

### Step 4 — Inspect the Pod

```bash
kubectl describe pod hello-world-7498cc9f6b-gdsqt -n openvoid-system
```

This is your most-used debugging command. It dumps everything about the Pod: image used, IP, events, status, mounted volumes, the lot. When something is broken, `describe pod` is the first command you run. The `Events:` section at the bottom is where Kubernetes tells you what went wrong.

```bash
kubectl logs hello-world-7498cc9f6b-gdsqt -n openvoid-system
# nginx: starting; kube-probe access logs; etc.

kubectl logs hello-world-7498cc9f6b-gdsqt -n openvoid-system --previous
# logs from the *previous* container if this Pod has restarted — invaluable
# when a Pod is in CrashLoopBackOff because the current container is dead.
```

### Step 5 — Get inside the Pod

```bash
kubectl exec -it hello-world-7498cc9f6b-gdsqt -n openvoid-system -- sh
# / # nginx -v
# nginx version: nginx/1.29.8
# / # exit
```

`exec -it ... -- <command>` runs `<command>` inside the Pod. Useful for poking around: `ls`, `cat`, `nginx -T`, etc.

### Step 6 — Reach the Pod from your browser

```bash
kubectl port-forward svc/hello-world 8080:80 -n openvoid-system
```

This opens a tunnel from `localhost:8080` (your laptop) → port 80 of the Service → port 80 of the Pod. While it runs:

```bash
curl http://localhost:8080
# <!DOCTYPE html><html>...nginx welcome page...</html>
```

Ctrl-C the port-forward when done. Port-forward dies with its process — there's no daemon.

### Step 7 — Watch a controller heal a broken thing

```bash
# Break it on purpose
kubectl set image deployment/hello-world nginx=nginx:does-not-exist-tag -n openvoid-system

# Watch what happens
kubectl get pods -n openvoid-system -w
# (Ctrl-C to stop watching)
```

You'll see a *new* Pod created with the bad image (it'll go to `ErrImagePull` → `ImagePullBackOff`) while the *old* Pod stays running. This is Kubernetes's rolling update behavior: Deployments don't break a working Pod until a new one is healthy. Excellent for safety. The new bad Pod is stuck.

```bash
kubectl describe pod -l app.kubernetes.io/name=hello-world -n openvoid-system | grep -A 5 Events:
# Failed to pull image "nginx:does-not-exist-tag": ...
```

### Step 8 — Roll back

```bash
kubectl rollout undo deployment/hello-world -n openvoid-system
kubectl rollout status deployment/hello-world -n openvoid-system
# deployment "hello-world" successfully rolled out
```

`rollout undo` returns the Deployment to its previous spec. The bad ReplicaSet drains; the old one stays at 1 replica. Same command pattern when an operator update breaks Phase 5+ down the line.

### Step 9 — Clean up

```bash
kubectl delete -f infra/local/hello-world.yaml
# service/hello-world deleted
# deployment.apps/hello-world deleted
# namespace/openvoid-system deleted
```

`delete -f <file>` is the inverse of `apply -f <file>`. Specific objects can also be deleted by name: `kubectl delete deployment hello-world -n openvoid-system`.

---

## 7. Reflecting changes to DOKS

The same manifest works against DOKS verbatim — Kubernetes is portable. The two things that change are the **context** and the **image source**.

### Context: just point at the other cluster

```bash
# If DOKS is running:
kubectl --context do-nyc1-openvoid-dev apply -f infra/local/hello-world.yaml
kubectl --context do-nyc1-openvoid-dev get all -n openvoid-system

# OR switch the active context first:
kubectl config use-context do-nyc1-openvoid-dev
kubectl apply -f infra/local/hello-world.yaml   # now applies against DOKS
```

Use `--context <name>` for one-off cross-cluster commands (less ambiguous than switching). Use `use-context` when you'll do many commands in a row against the same cluster.

For hello-world the manifest pulls `nginx:alpine` from Docker Hub — public, anonymous pulls work. So nothing else changes.

### Image source: local registry vs GHCR

This is where the kind ↔ DOKS difference shows up. When we build openvoid's own services (Phase 3+), the image lives somewhere:

- **kind**: built locally, pushed to `localhost:5001`. The kind node pulls from `kind-registry:5000` over the kind network.
- **DOKS**: built in CI (or locally with `docker buildx`), pushed to GHCR (`ghcr.io/openvoid/<service>:<sha>`). The DOKS node pulls from GHCR over the public internet.

The same Pod spec can't reference both. Until Phase 5 adds the Helm chart, this means one of two things:

1. **For local dev:** keep manifests pointing at `localhost:5001`, only deploy them to kind.
2. **For DOKS demos:** use a separate manifest (or values file) pointing at GHCR.

Phase 5 fixes this with one Helm chart that takes the registry/tag as values:

```yaml
# infra/helm/values/local.yaml
operator:
  image:
    repository: localhost:5001/openvoid/session-operator
    tag: dev

# infra/helm/values/dev.yaml
operator:
  image:
    repository: ghcr.io/openvoid/session-operator
    tag: <commit-sha>
```

Same chart, different values. Phase 6 adds ArgoCD which makes the DOKS deploy automatic on every merge to `main`.

Until then, treat DOKS as "occasionally exercised, manually." The Phase 2 hello-world manifest works on DOKS today because it uses a public image — but openvoid-built services don't yet, and won't until Phase 5.

---

## 8. When something breaks — a debugging checklist

Run these in order. 80% of issues fall out by step 3.

```bash
# 1. Where am I? (cheap; saves embarrassing mistakes)
bash scripts/kctx-check.sh

# 2. What's actually there?
kubectl get all -n <namespace>
# Look at STATUS column and AGE.

# 3. Why is THAT Pod unhappy?
kubectl describe pod <name> -n <namespace>
# Read the Events: section at the bottom. Reads forward in time.

# 4. What did the container itself say?
kubectl logs <name> -n <namespace>
kubectl logs <name> -n <namespace> --previous   # if it just crashed

# 5. Get inside and poke around
kubectl exec -it <name> -n <namespace> -- sh

# 6. Cluster-wide events
kubectl get events -n <namespace> --sort-by='.lastTimestamp'

# 7. Check that the Service has the Endpoints it should
kubectl get endpoints <service-name> -n <namespace>
# If empty: your Service's selector doesn't match any Pod's labels.

# 8. Resource pressure — is the node out of CPU or memory?
kubectl describe node
```

Common failures and what they mean:

| Status | Meaning | First check |
|---|---|---|
| `Pending` | Pod hasn't been scheduled | `describe pod` → events likely show "Insufficient cpu/memory" or "no PV available" |
| `ContainerCreating` (long) | Image pull or volume mount stuck | `describe pod` → events |
| `ImagePullBackOff` / `ErrImagePull` | Bad image name, wrong registry, or auth issue | `describe pod` → exact image string; verify it exists |
| `CrashLoopBackOff` | Container starts and exits; K8s keeps retrying with backoff | `kubectl logs --previous` |
| `Running` but Service unreachable | Selector mismatch or readiness probe failing | `kubectl get endpoints` and `describe pod` |
| `Terminating` (long) | Finalizer waiting; or `terminationGracePeriodSeconds` ticking down | `describe pod` → look for finalizers |

### A specific gotcha you've already hit

OpenCode's HTTP server (Phase 6) returns **HTTP 200 with an HTML page** for *any* unknown path — it's a SPA fallback. So this is misleading:

```bash
curl -i http://localhost:8080/last-activity
HTTP/1.1 200 OK
content-type: text/html
<!doctype html><html lang="en"...
```

A 200 doesn't prove the endpoint exists. Once we wire the operator to poll OpenCode in Phase 6, the operator code checks `Content-Type` and JSON-parses the body, not just the status. The spike at `docs/spikes/2026-05-02-opencode-endpoints.md` documents this.

---

## 9. What's coming next that changes this flow

| Phase | What it adds | How your flow changes |
|---|---|---|
| **3** | Tilt + Session API skeleton + TypeSpec | `tilt up` replaces the manual edit→build→push→apply loop for openvoid services. Tilt watches files, rebuilds, redeploys. You still use kubectl to *inspect*, but not to *deploy*. |
| **4** | CodingSession CRD | `kubectl get codingsessions` becomes a thing. The CRD is just data; the operator lands in 5. |
| **5** | Session Operator + Helm chart skeleton + ArgoCD wiring + NetworkPolicy | Helm chart becomes the source of truth for "what's deployed where." Local: chart rendered by Tilt. DOKS: chart reconciled by ArgoCD on every merge to `main`. |
| **6** | Real OpenCode image | First time we ship an in-pod long-running agent. PVC + idle-detection arrive in 7. |
| **9** | Web UI + NextAuth + cloudflared | Public-facing demo URL with GitHub OAuth gate. |

The most impactful change is Phase 3. Your daily loop goes from "edit, apply, get, port-forward, curl, repeat" to "edit, look at the Tilt UI in your browser, the rest happens automatically." That's the inflection point where this manual flow becomes background knowledge instead of daily practice.

Phase 5 is the second inflection: ArgoCD takes over DOKS deploys, so you never `kubectl apply` against DOKS again — you push to `main` and ArgoCD reconciles.

---

## 10. Quick command reference

```bash
# ---- Cluster lifecycle ----
bash scripts/kind-up.sh                       # local cluster up
bash scripts/kind-down.sh                     # local cluster down
bash infra/remote/doks-create.sh              # DOKS up (~$24/mo while running)
bash infra/remote/doks-destroy.sh             # DOKS down (stops billing)
bash scripts/check-tools.sh                   # toolchain audit

# ---- Context safety ----
kubectl config get-contexts                   # list contexts
kubectl config current-context                # name of active one
kubectl config use-context <name>             # switch
bash scripts/kctx-check.sh                    # confirm + color-code
kubectx                                       # if installed: interactive picker

# ---- Daily inspection ----
kubectl get all -n <ns>                       # everything in a namespace
kubectl get pods -A                           # pods across all namespaces
kubectl describe <kind>/<name> -n <ns>        # full state + events
kubectl logs <pod> -n <ns>                    # current container's logs
kubectl logs <pod> -n <ns> --previous         # previous container's logs (after crash)
kubectl logs <pod> -n <ns> -f                 # follow (tail)
kubectl exec -it <pod> -n <ns> -- sh          # shell in
kubectl get events -n <ns> --sort-by='.lastTimestamp'

# ---- Apply, edit, undo ----
kubectl apply -f <file-or-dir>                # do-what-I-mean create/update
kubectl delete -f <file>                      # inverse of apply
kubectl edit <kind>/<name> -n <ns>            # edit live in $EDITOR
kubectl rollout status deployment/<n> -n <ns>
kubectl rollout undo deployment/<n> -n <ns>
kubectl wait --for=condition=Ready pod/<n> -n <ns> --timeout=60s

# ---- Network ----
kubectl port-forward svc/<n> 8080:80 -n <ns>  # tunnel a service port to localhost
kubectl get endpoints <svc> -n <ns>           # is the Service hitting the right Pods?
```

That's the whole pre-Phase-3 vocabulary. The rest of the v1 plan replaces most of these `kubectl apply` invocations with Tilt and ArgoCD doing the work for you. But you'll still reach for `kubectl get / describe / logs` every day — those are the diagnosis tools that don't get automated away.
