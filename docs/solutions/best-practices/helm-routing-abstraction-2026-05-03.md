---
title: Push cluster-fabric differences into Helm values, not the operator
date: 2026-05-03
category: best-practices
module: infra/helm
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Designing a Helm chart for a K8s-native app that has an operator creating per-instance resources
  - Multiple target cluster fabrics differ in how public exposure works (Ingress, Route, Tunnel, port-forward)
  - The team wants to add a new target cluster (e.g., OpenShift) without rearchitecting the operator
related_components:
  - session-operator
  - infra/helm/openvoid
tags:
  - helm
  - kubernetes
  - openshift
  - cluster-portability
  - operator-pattern
  - routing
  - chart-design
---

# Push cluster-fabric differences into Helm values, not the operator

## Context

openvoid v1 targets two cluster fabrics: **kind** locally (port-forward) and **DOKS** remotely (cloudflared tunnel + wildcard CNAME). Phase 3 lands the API surface; Phase 5 introduces the operator that creates per-session Pods/Services; Phase 9 wires the public exposure layer.

During the Phase 3 demo a real-world question surfaced: *"we'd like to replicate this inside our company on OpenShift; what changes?"*

The naive answer ("rearchitect Phase 5–9 in v1.5 when we get there") would have left v1's operator code with cluster-fabric assumptions baked in — for example, "the operator creates a `cloudflared`-aware Service annotation" or "the operator installs an Ingress." Either choice would have made OpenShift adoption a refactor instead of an additive change.

## Guidance

Keep the **operator** cluster-neutral and let the **Helm chart** carry every cluster-fabric difference behind a single value:

1. **Operator behavior is invariant across clusters.** It always emits the same per-instance K8s primitives — for openvoid, a `Service` per session with named ports `agent-http` and `preview-http`. Nothing in the Go code knows whether it's running on kind, DOKS, OpenShift, or anything else.

2. **Chart values pick the exposure mode.** `values.yaml` declares:

   ```yaml
   routing:
     mode: cloudflared        # default; reserved values: openshift-route, ingress
     cloudflared:
       tunnelId: ""
       domain: ""
   ```

3. **One template per mode under a dedicated subdirectory.** `templates/routing/cloudflared.yaml`, `templates/routing/openshift-route.yaml`, `templates/routing/ingress.yaml`. Each is gated by `{{ if eq .Values.routing.mode "<mode>" }}`. Adding a new mode is a net-new file — never a change to existing templates and never a change to the operator.

4. **Per-cluster values files set the mode.** `values/local.yaml` (kind: port-forward, no routing template), `values/dev.yaml` (DOKS: cloudflared), `values/openshift.yaml` (OpenShift: openshift-route).

5. **Container images are chart-portable too.** Apply the SCC-friendly file-ownership pattern unconditionally so the same image runs everywhere:

   ```dockerfile
   # Before declaring USER 1000:
   RUN chgrp -R 0 /opt/app /workspace \
    && chmod -R g=u /opt/app /workspace
   USER 1000
   ```

   On stock K8s and DOKS the image runs as UID 1000 as written. On OpenShift, the `restricted-v2` SCC overrides `USER` with a per-namespace random UID; because the directories are owned by GID 0 and group-writable, the random UID can still write. The cost is two RUN tokens; the benefit is one image manifest across every cluster.

## Why This Matters

**Without this pattern**, every new cluster target multiplies operator complexity:

- Operator branches on `os.Getenv("CLUSTER_FABRIC")` to decide whether to emit a `Route` or a cloudflared annotation.
- Tests need fixtures per fabric.
- Migrations between fabrics touch operator code, which needs a release.
- Security review of the operator widens — it now mints fabric-specific objects.

**With this pattern**, every new cluster target is a self-contained chart change:

- One new `templates/routing/<mode>.yaml`.
- One new `values/<cluster>.yaml`.
- Operator unchanged. Tests unchanged. CI gate unchanged.

The strategic win is that **the operator's RBAC stays minimal** (it only needs Pod + Service permissions, not Route or Ingress permissions). Each fabric-specific resource is reconciled by the platform's own controller (HAProxy router for OpenShift, Ingress controller for cert-manager-equipped clusters, cloudflared Deployment for DOKS), not by openvoid.

## When to Apply

- Any K8s-native app whose operator creates resources that need public exposure.
- Multi-fabric targets are real (or anticipated). If the app will *only* ever run on one cluster, this abstraction is overhead — wait until a second target is concrete.
- The cost of this seam is small upfront (one Helm directory + one values key). The cost of *not* having it later is real (operator refactor, test backfill, RBAC widening).

Don't apply this pattern when:

- There's only one target cluster and there's no credible second one. YAGNI.
- The exposure is *truly* identical across targets (e.g., `LoadBalancer` Services everywhere — though this is rare once you account for cost differences).
- The operator's resource model differs per fabric for reasons unrelated to exposure. In that case, the seam belongs deeper than Helm.

## Examples

**Cluster-fabric matrix** (the v1 plan's "v1.5 OpenShift readiness matrix" — the structure that crystallized this pattern):

| Concern | kind | DOKS | OpenShift |
|---|---|---|---|
| Public per-session URL | `kubectl port-forward` (Tilt-managed) | cloudflared tunnel + wildcard CNAME | `Route` per session under `*.apps.<cluster>` |
| `routing.mode` value | (no template — port-forward done by Tilt) | `cloudflared` | `openshift-route` |
| TLS | n/a | Cloudflare Universal SSL | Cluster default cert |
| NetworkPolicy enforcement | optional (kind CNI doesn't enforce by default) | enforced (Cilium/Calico) | mandatory (OVN-Kubernetes) |
| Image identity | runs as `USER 1000` | runs as `USER 1000` | random per-namespace UID via SCC `restricted-v2` |

**Chart layout** (operator-neutral, exposure-pluggable):

```
infra/helm/openvoid/
├── Chart.yaml
├── values.yaml                      # defaults: routing.mode = cloudflared
├── templates/
│   ├── operator/                    # cluster-neutral
│   │   ├── crd.yaml
│   │   ├── rbac.yaml
│   │   └── deployment.yaml
│   ├── session-api/                 # cluster-neutral
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   ├── sessions/
│   │   └── networkpolicy.yaml       # cluster-neutral; enforcement varies by CNI
│   └── routing/                     # cluster-fabric seam
│       ├── cloudflared.yaml         # gated: routing.mode == "cloudflared"
│       ├── openshift-route.yaml     # gated: routing.mode == "openshift-route" (v1.5)
│       └── ingress.yaml             # gated: routing.mode == "ingress" (v1.5)
└── values/
    ├── local.yaml                   # kind defaults
    ├── dev.yaml                     # DOKS: routing.mode = cloudflared
    └── openshift.yaml               # OpenShift: routing.mode = openshift-route (v1.5)
```

**Operator code (illustrative — same shape on every cluster):**

```go
// reconcile creates two K8s primitives per session, regardless of cluster fabric.
// The chart decides how those Services are exposed publicly.
func (r *CodingSessionReconciler) reconcile(ctx context.Context, cs *v1alpha1.CodingSession) error {
    if err := r.ensurePod(ctx, cs); err != nil {
        return err
    }
    if err := r.ensureService(ctx, cs); err != nil {  // names ports agent-http + preview-http
        return err
    }
    return nil
}
```

The operator never references `Route`, `Ingress`, or cloudflared. Those are chart concerns.

## Related

- `docs/plans/2026-05-01-001-feat-v1-staged-walkthrough-plan.md` — Key Technical Decisions ("Routing is a Helm-level abstraction…"), v1.5 OpenShift readiness matrix, Unit 5.6 (chart values), Unit 6.1 (SCC-friendly Dockerfile pattern).
- v1 plan rev 3 commit (`522642f`) — captures the decision and the seams in the plan itself.
