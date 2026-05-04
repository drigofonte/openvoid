# syntax=docker/dockerfile:1.7
# OpenCode agent image — per-session main container.
#
# Boots `opencode serve` on :8080. Ships a baked-in opencode.json (model
# selection + permission allowlist; Phase 8 tightens the latter) and
# expects an `auth.json` Secret to be runtime-mounted by the Session API
# at /var/opencode-data/opencode/auth.json. XDG paths are pinned to
# absolute locations so the image is SCC-friendly (random-UID safe under
# OpenShift v1.5) and so Phase 8's `opencode.json` denylist can reference
# one canonical auth-file path. See:
#   - docs/spikes/2026-05-05-opencode-auth.md (Unit 6.0 decision)
#   - infra/images/opencode/README.md (runtime interface)

ARG NODE_VERSION=20-alpine

FROM node:${NODE_VERSION} AS builder
WORKDIR /opt/opencode

# `opencode-ai` ships a small JS wrapper plus a platform-specific
# optional dependency (the bun-compiled binary). npm picks the right
# binary for the build container's OS/arch — since `docker build` runs
# in a Linux container, both glibc and musl variants are installed and
# the postinstall picks one to cache as `bin/.opencode`. On alpine
# (musl-only) the cache occasionally lands on the glibc variant, which
# fails to run with ENOENT-on-not-found. Drop the cache so the
# wrapper's dynamic resolution at runtime picks the `-musl`-suffixed
# package, and prune any non-musl linux platform packages so the image
# only carries the binary it can actually execute.
RUN npm install --omit=dev --no-audit --no-fund --no-package-lock opencode-ai@1.14.33 \
 && rm -f /opt/opencode/node_modules/opencode-ai/bin/.opencode \
 && for d in /opt/opencode/node_modules/opencode-linux-*; do \
      case "$d" in *-musl) ;; *) rm -rf "$d" ;; esac; \
    done

FROM node:${NODE_VERSION}

# XDG paths pinned to absolute locations independent of $HOME. Rationale
# is in docs/spikes/2026-05-05-opencode-auth.md: under OpenShift SCC the
# random runtime UID has no /etc/passwd entry, so $HOME-relative path
# resolution breaks; absolute paths sidestep that entirely. The same
# paths work identically on kind/DOKS, so this is parity-positive.
#
# HOME is also pinned, because OpenCode's bun runtime (and other XDG
# variables we haven't explicitly overridden — XDG_STATE_HOME,
# XDG_CACHE_HOME) fall back to `$HOME/.local/...` and `$HOME/.cache`.
# When HOME isn't overridden, a random UID with no /etc/passwd entry
# resolves $HOME to "/" and any cache/state mkdir hits EACCES.
ENV HOME=/var/opencode-data \
    XDG_DATA_HOME=/var/opencode-data \
    XDG_CONFIG_HOME=/var/opencode-config

# Bring across the installed package tree and surface the platform
# binary on PATH. We deliberately bypass the `opencode-ai` JS wrapper
# (which would be at node_modules/.bin/opencode) and symlink straight
# to the bun-compiled musl binary — the wrapper's `spawnSync` keeps
# `node` as PID 1 and does not forward SIGTERM to the child opencode
# process, which breaks the Phase 5 SIGTERM cascade (kubelet → main
# → finalizer). With a direct symlink, the binary itself becomes
# PID 1 and receives SIGTERM directly.
COPY --from=builder /opt/opencode/node_modules /opt/opencode/node_modules
RUN ln -sf "$(find /opt/opencode/node_modules -path '*linux-*-musl/bin/opencode' -type f | head -1)" /usr/local/bin/opencode

# Baked-in config and entrypoint.
COPY opencode.json /var/opencode-config/opencode/opencode.json
COPY entrypoint.sh /usr/local/bin/opencode-entrypoint
RUN chmod +x /usr/local/bin/opencode-entrypoint

# SCC-friendly ownership: owner UID 1000 (the default kind/DOKS path)
# AND group 0 with user-equivalent permissions (the OpenShift SCC path,
# where the random runtime UID has primary GID 0). Both paths need to
# write the SQLite DB OpenCode initializes on first boot, plus the repo
# workdir. Without the chown, alpine's `node` user (UID 1000, GID 1000)
# can't write to chgrp-0 dirs — the user isn't a group-0 member.
RUN mkdir -p /var/opencode-data/opencode /workspace/repo \
 && chown -R 1000:0 /var/opencode-data /var/opencode-config /workspace \
 && chmod -R g=u /var/opencode-data /var/opencode-config /workspace

# Run as the cloned repo so the agent's cwd matches /workspace/repo.
# The directory is created above so `docker run` without a volume mount
# still boots cleanly for the local image-validation flow.
WORKDIR /workspace/repo
EXPOSE 8080
USER 1000

# entrypoint.sh stays PID 1 and traps SIGTERM, forwarding it to the
# `opencode serve` child. OpenCode's binary does not install a SIGTERM
# handler, so as PID 1 it ignores SIGTERM (Linux's PID-1 special case)
# and the kubelet's grace-window expiration is the only thing that
# stops the container — too late for the Phase 5 finalizer cascade.
# As a non-PID-1 child it honours the default Terminate disposition.
ENTRYPOINT ["/usr/local/bin/opencode-entrypoint"]
CMD []
