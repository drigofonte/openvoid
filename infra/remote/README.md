# DOKS demo cluster

Scripts and notes for the openvoid v1 DOKS demo cluster.

## TL;DR

```bash
# One-time per machine: authenticate doctl with a DO API token.
doctl auth init

# Bring up the cluster (~5 min, starts billing).
bash infra/remote/doks-create.sh

# Tear it down between work sessions to stop billing.
bash infra/remote/doks-destroy.sh
```

## Cost

| Component | Default | Monthly cost (running 24/7) | Notes |
|---|---|---|---|
| Worker nodes | 1× `s-2vcpu-4gb` | ~$24/mo | scales linearly per node |
| Control plane | standard (free) | $0 | HA control plane is +$40/mo; v1 doesn't need it |
| Block storage | provisioned per session via PVC | ~$0.10/GiB-month | ~$1/mo for a 10 GiB workspace |
| LoadBalancers | none in v1 | $0 | v1 uses cloudflared, not DO LB ($12/mo each) |

**Default v1 cost while a cluster is running:** ~$24/mo prorated by the second.

**Cost discipline:** **Always run `doks-destroy.sh` between sessions.** A cluster left running over a weekend costs ~$1.60. A cluster left running for a month costs ~$24. The cluster bootstraps in ~5 minutes from `doks-create.sh`, so destroy-and-recreate is the default workflow.

## Sizing for multi-user demos

The default 1× `s-2vcpu-4gb` node hosts:
- The operator (~150–250 Mi RAM)
- The Session API (~150–300 Mi)
- The Web UI (~250–400 Mi)
- The cloudflared tunnel (~80–150 Mi)
- One active OpenCode session pod (1 Gi request, 3 Gi limit)
- DOKS system overhead (~768 Mi reserved)

That sum is tight — adequate for **one** active session. For multi-stakeholder demos (two or more concurrent sessions), bump the node size before running:

```bash
OPENVOID_DO_NODE_SIZE=s-2vcpu-8gb bash infra/remote/doks-create.sh
```

Cost approximately doubles to ~$48/mo. Or scale the node count instead of size — `OPENVOID_DO_NODE_COUNT=2`.

## Region

Default region is `nyc1`. Change for non-US implementers:

```bash
OPENVOID_DO_REGION=lon1 bash infra/remote/doks-create.sh
```

`doctl kubernetes options regions` lists every supported region.

## Kubeconfig and context

`doctl kubernetes cluster create` defaults `--update-kubeconfig=true` and `--set-current-context=true`, so after `doks-create.sh` your `kubectl` is already pointed at the new cluster. The context name is `do-<region>-<cluster-name>`, e.g. `do-nyc1-openvoid-dev`.

To re-fetch the kubeconfig later (e.g., on a fresh laptop):

```bash
doctl kubernetes cluster kubeconfig save openvoid-dev
```

## Orphaned resources after destroy

`doks-destroy.sh` deletes the cluster with `--dangerous` (skips kubeconfig prompt). DigitalOcean automatically cleans up most resources, but **LoadBalancers and Block Storage volumes are billed independently** and can outlive the cluster if Kubernetes wasn't given time to garbage-collect cleanly. After every destroy, verify:

```bash
doctl compute load-balancer list   # expect: empty
doctl compute volume list          # expect: empty (or pre-existing volumes you own)
```

If anything orphaned shows up, delete via `doctl compute <kind> delete <id>` or the DO control panel.

## Why no Helm-managed cluster bootstrap

The cluster itself (the kubernetes thing) is provisioned by `doctl`. Everything *inside* the cluster (operator, Session API, Web UI, cloudflared) is deployed via the Helm chart at `infra/helm/openvoid/` once Phase 5 lands — see the plan for sequencing.
