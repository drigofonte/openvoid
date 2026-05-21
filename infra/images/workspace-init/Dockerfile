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
# (built into node 22) and just needs activation. Pin pnpm@10 to
# match the scaffold's `packageManager: "pnpm@10.x"` field so
# corepack doesn't need to download a different version at runtime.
RUN apk add --no-cache git \
    && corepack enable \
    && corepack prepare pnpm@10 --activate

COPY init.sh /usr/local/bin/workspace-init
RUN chmod +x /usr/local/bin/workspace-init

ENTRYPOINT ["/usr/local/bin/workspace-init"]
CMD []
