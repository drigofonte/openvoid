# openvoid Tiltfile — local kind dev orchestrator.
#
# Phase 3: brings up @openvoid/session-api inside the kind-openvoid-local
# cluster with hot-reload from services/session-api/src/. Subsequent phases
# extend this file (operator in Phase 5, OpenCode image in Phase 6, Web UI
# in Phase 9).
#
# Run: `tilt up`. The Tilt UI lands at http://localhost:10350/.

# Refuse to run against anything other than the local kind cluster. Without
# this, a stale kubeconfig pointing at DOKS would let `tilt up` deploy to a
# paid cluster.
allow_k8s_contexts("kind-openvoid-local")

# Apply the namespaces, ServiceAccount, RBAC, Deployment, and Service for
# the Session API. Tilt watches the file and re-applies on edits.
k8s_yaml("infra/local/session-api.yaml")

# Build the dev image straight from the repo root so the workspace context
# (root package.json, pnpm-lock.yaml, packages/protocol, services/session-api)
# is all available to the build.
docker_build(
    "localhost:5001/openvoid/session-api:dev",
    context=".",
    dockerfile="services/session-api/Dockerfile",
    target="dev",
    only=[
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "turbo.json",
        "packages/protocol",
        "services/session-api",
    ],
    live_update=[
        # Hot-sync source into the running container; tsx watch picks up the
        # change and restarts in ~1 s without an image rebuild. Changes to
        # package.json/pnpm-lock.yaml fall outside these syncs and trigger a
        # full image rebuild — that's intentional, since deps need reinstall.
        sync("./services/session-api/src", "/workspace/services/session-api/src"),
        sync(
            "./packages/protocol/generated",
            "/workspace/packages/protocol/generated",
        ),
    ],
)

k8s_resource(
    "session-api",
    port_forwards=[port_forward(4000, 4000, name="http")],
    labels=["api"],
)
