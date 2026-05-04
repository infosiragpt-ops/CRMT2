#!/bin/bash
set -euo pipefail

pnpm install --frozen-lockfile
pnpm --filter @workspace/db push
