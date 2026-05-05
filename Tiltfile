# openvoid Tiltfile — local kind dev orchestrator.
#
# Phase 3: brings up @openvoid/session-api inside the kind-openvoid-local
# cluster with hot-reload from services/session-api/src/. Subsequent phases
# extend this file (git-finalizer sidecar in Phase 5, OpenCode image in
# Phase 6, Helm chart in Phase 7, Web UI in Phase 9).
#
# Run: `tilt up`. The Tilt UI lands at http://localhost:10350/.

# Refuse to run against anything other than the local kind cluster. Without
# this, a stale kubeconfig pointing at DOKS would let `tilt up` deploy to a
# paid cluster.
allow_k8s_contexts("kind-openvoid-local")

# Apply the namespaces, ServiceAccount, RBAC, Deployment, and Service for
# the Session API. Tilt watches the file and re-applies on edits.
k8s_yaml("infra/local/session-api.yaml")

# Phase 7: landing page Deployment + Service + Ingress, plus an Ingress
# in front of the Session API at api.127.0.0.1.nip.io.
k8s_yaml("infra/local/landing.yaml")

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

# Landing page (Remix 3). Built from the workspace root so the build
# context can see @openvoid/protocol. The kind ingress at
# app.127.0.0.1.nip.io is what end users hit; the port_forward is a
# convenience for direct dev hits without the ingress in the loop.
#
# `OPENVOID_API_URL` is now a runtime env var on the Deployment (set
# in infra/local/landing.yaml), not a build-arg — one image works for
# both kind and DOKS.
docker_build(
    "localhost:5001/openvoid/landing:dev",
    context=".",
    dockerfile="services/landing/Dockerfile",
    only=[
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "turbo.json",
        "packages/protocol",
        "services/landing",
    ],
)

k8s_resource(
    "landing",
    port_forwards=[port_forward(8088, 3000, name="http")],
    labels=["ui"],
)

# Per-session Pod images. Tilt never sees a tracked manifest pointing at
# these (the Session API creates per-session Pods dynamically, so the only
# references are at runtime). `docker_build` would therefore build but not
# push to the kind registry, leaving Pods in Init:ImagePullBackOff. Use a
# `local_resource` per image that explicitly builds and pushes.
# Build, push, and bust the kind node's cached copy. The cache-bust
# is required because the kind node pulls `:dev` once and then keeps
# the cached blob — `imagePullPolicy: IfNotPresent` (the K8s default
# for non-`:latest` tags) means a freshly-rebuilt `:dev` image gets
# ignored at the next pod creation. `crictl rmi` deletes the cached
# image; the next pod pull goes back to localhost:5001 for the new
# layers. `|| true` handles the first-run case where nothing is
# cached yet.
def session_pod_image(name, dir):
    image = "localhost:5001/openvoid/{}:dev".format(name)
    local_resource(
        "{}-image".format(name),
        cmd=" && ".join([
            "docker build -t {} {}".format(image, dir),
            "docker push {}".format(image),
            "docker exec openvoid-local-control-plane crictl rmi {} || true".format(image),
        ]),
        deps=[dir],
        labels=["images"],
    )

session_pod_image("git-clone",     "infra/images/git-clone")
session_pod_image("git-finalizer", "infra/images/git-finalizer")
session_pod_image("opencode",      "infra/images/opencode")
