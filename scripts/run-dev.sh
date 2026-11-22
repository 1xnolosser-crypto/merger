#!/bin/bash
# Dev launcher — reads DATABASE_URL / DATABASE_AUTH_TOKEN from .env (gitignored).
cd /home/z/my-project
set -a
source .env
set +a
exec bun run dev
