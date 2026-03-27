#!/bin/bash
# Builds a signed + notarized macOS DMG.
# Credentials are loaded from .env.signing (gitignored).
# Copy .env.signing.example to .env.signing and fill in your values.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.signing"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found. Copy .env.signing.example and fill in your credentials."
  exit 1
fi

set -a
# shellcheck source=../.env.signing
source "$ENV_FILE"
set +a

npm run build:mac
