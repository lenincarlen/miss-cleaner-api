#!/bin/sh
set -e

SCHEMA="prisma/schema.prisma"

echo "=== Initializing database ==="

echo "1. Creating extensions and functions..."
npx prisma db execute --schema "$SCHEMA" --file prisma/init.sql 2>&1

echo "2. Pushing Prisma schema..."
npx prisma db push --schema "$SCHEMA" --accept-data-loss 2>&1

echo "3. Seeding initial data..."
npx prisma db execute --schema "$SCHEMA" --file prisma/seed.sql 2>&1

echo "4. Starting application..."
exec node dist/src/index.js
