#!/bin/bash
cd /home/z/my-project
export DATABASE_URL="libsql://test-shin-mod.aws-eu-west-1.turso.io"
export DATABASE_AUTH_TOKEN="REDACTED"
exec bun run dev
