# workspace-init — initContainer image.
#
# Two boot paths share one image. The import-repo path just needs
# git; the new-app path adds `pnpm install` on top of the scaffold
# clone, so the image bumps from alpine/git to node:20-alpine + git +
# pnpm. That costs ~150 MB (vs. ~25 MB on alpine/git), pulled once
# per cluster — acceptable for v1. See init.sh for the runtime
# contract.
FROM node:20-alpine

# node:20-alpine ships node but not git; pnpm comes via corepack
# (built into node 20+) and just needs activation. Pinning pnpm@9
# matches the workspace's package manager.
RUN apk add --no-cache git \
    && corepack enable \
    && corepack prepare pnpm@9 --activate

COPY init.sh /usr/local/bin/workspace-init
RUN chmod +x /usr/local/bin/workspace-init

ENTRYPOINT ["/usr/local/bin/workspace-init"]
CMD []
