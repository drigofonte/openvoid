# workspace-init — initContainer image.
#
# Two boot paths share one image. The import-repo path just needs
# git; the new-app path adds `pnpm install` on top of the scaffold
# clone, so the image bumps from alpine/git to node:22-alpine + git +
# pnpm. That costs ~150 MB (vs. ~25 MB on alpine/git), pulled once
# per cluster — acceptable for v1. See init.sh for the runtime
# contract.
#
# Node 22 specifically: the canonical scaffold's `package.json`
# declares `engines.node: "^22 || >=24"` (matches what `pnpm create
# vite` + RR7 framework mode generate today). Node 20 caused
# `ERR_PNPM_UNSUPPORTED_ENGINE` on `pnpm install --frozen-lockfile`.
FROM node:22-alpine

# node:22-alpine ships node but not git; pnpm comes via corepack
# (built into node 22) and just needs activation. Pin the EXACT
# pnpm version the scaffold's `packageManager` field declares so
# corepack uses it from cache instead of downloading a different
# patch version on every session boot (visible in `kubectl logs` as
# a "Corepack is about to download pnpm-X.Y.Z.tgz" line + a multi-
# second delay each time a session starts).
#
# Bump in lockstep with whatever `pnpm create vite` / RR7 framework
# mode currently generates. If the scaffold's lockfile is updated,
# update this pin too.
RUN apk add --no-cache git \
    && corepack enable \
    && corepack prepare pnpm@10.33.0 --activate

COPY init.sh /usr/local/bin/workspace-init
RUN chmod +x /usr/local/bin/workspace-init

ENTRYPOINT ["/usr/local/bin/workspace-init"]
CMD []
