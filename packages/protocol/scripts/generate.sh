#!/usr/bin/env bash
# Regenerate openapi.yaml and types.ts from main.tsp.
# Run from anywhere; resolves paths relative to the package root.
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PACKAGE_DIR"

echo "==> Compiling TypeSpec → OpenAPI 3.1"
pnpm exec tsp compile .

echo "==> Generating TypeScript types from OpenAPI"
pnpm exec openapi-typescript generated/openapi.yaml -o generated/types.ts

echo "==> Done. Generated:"
ls -1 generated/
