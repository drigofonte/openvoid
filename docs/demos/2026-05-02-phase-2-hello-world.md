---
date: 2026-05-02
topic: phase-2-hello-world
status: demoed
plan-unit: docs/plans/2026-05-01-001-feat-v1-staged-walkthrough-plan.md (Phase 2)
---

# Phase 2 Demo — Hello-World Pod

Trivial nginx Pod + Service deployed to kind, port-forwarded, exercised against every kubectl essential. No openvoid-specific code yet — pure muscle memory.

## Manifest

`infra/local/hello-world.yaml` defines:

- A `Namespace` named `openvoid-system` (reused by Phase 5+ for the operator + Session API).
- A `Deployment` running `nginx:alpine` × 1 with a tiny resource budget (10m CPU request, 16Mi memory request, 64Mi limit).
- A `ClusterIP Service` exposing port 80 inside the cluster.

The Pod has a readinessProbe on `/` so `kubectl wait --for=condition=Ready` is meaningful.

## kubectl essentials walked

```bash
kubectl apply -f infra/local/hello-world.yaml
# → namespace/openvoid-system created
# → deployment.apps/hello-world created
# → service/hello-world created

kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=hello-world -n openvoid-system --timeout=60s
# → pod/hello-world-7498cc9f6b-gdsqt condition met

kubectl get all -n openvoid-system
# → Pod, Service, Deployment, ReplicaSet all listed

kubectl describe pod <pod> -n openvoid-system
# → Status: Running, IP: 10.244.0.5, Events: empty (clean start)

kubectl logs <pod> -n openvoid-system --tail=3
# → nginx start worker process; kube-probe GET / → 200 (readiness)

kubectl exec <pod> -n openvoid-system -- sh -c 'nginx -v && uname -a'
# → nginx version: nginx/1.29.8
# → Linux hello-world-... 6.12.72-linuxkit ... aarch64 Linux

kubectl port-forward svc/hello-world 8080:80 -n openvoid-system &
curl http://localhost:8080
# → <!DOCTYPE html><title>Welcome to nginx!</title>...
# → HTTP/1.1 200 OK
```

## Failure-mode drill — ImagePullBackOff and recovery

The plan includes a debugging-muscle drill. Walk it:

```bash
kubectl set image deployment/hello-world nginx=nginx:does-not-exist-tag -n openvoid-system
# new ReplicaSet rolls; new Pod enters ErrImagePull / ImagePullBackOff
# old Pod stays Running because the rollout is gated on readiness

kubectl get pods -n openvoid-system
# →  hello-world-7498cc9f6b-gdsqt   1/1   Running
# →  hello-world-84d6bfd485-sc8d4   0/1   ErrImagePull

kubectl describe pod <bad-pod> -n openvoid-system
# → Events: Failed to pull image "nginx:does-not-exist-tag": not found

kubectl rollout undo deployment/hello-world -n openvoid-system
kubectl wait --for=condition=Available deployment/hello-world -n openvoid-system --timeout=30s
# → rolled back; bad ReplicaSet drains
```

The rollout-rollback pattern is the same one Phase 5+ will use when an operator rolls a bad operator image. Worth internalizing.

## DOKS parity (not exercised in this demo)

The same manifest works against DOKS verbatim:

```bash
bash infra/remote/doks-create.sh   # if not already running
kubectl --context do-nyc1-openvoid-dev apply -f infra/local/hello-world.yaml
kubectl --context do-nyc1-openvoid-dev port-forward svc/hello-world 8080:80 -n openvoid-system
curl http://localhost:8080
# → 200 OK
```

Skipped in this session for cost discipline. Run when you want to verify DOKS parity end-to-end.

## Cleanup

```bash
kubectl delete -f infra/local/hello-world.yaml
# → service/hello-world deleted
# → deployment.apps/hello-world deleted
# → namespace/openvoid-system deleted   (Phase 5 will recreate it)
```

Or leave it running — Phase 3 reuses `openvoid-system` for the Session API.

## What this proves

- ✅ kind cluster works end-to-end (image pull, scheduling, networking).
- ✅ `nginx:alpine` pulls cleanly from Docker Hub on this network.
- ✅ Port-forward + curl path is reliable.
- ✅ The implementer can fluently use `apply`, `get`, `describe`, `logs`, `exec`, `port-forward`, `wait`, `set image`, `rollout undo`, `delete`.

## What it explicitly does NOT prove

- The local registry at `localhost:5001` (no image was pushed there yet — Phase 3 is the first consumer).
- DOKS parity (manifest works, but not run here).
- Anything openvoid-specific (no CRD, no operator, no Session API).
- Helm or ArgoCD (Phase 5+).
