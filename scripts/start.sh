#!/bin/sh
set -e

echo "=== Initializing database ==="

echo "1. Creating extensions and functions..."
npx prisma db execute --file prisma/init.sql 2>&1 || echo "Init SQL done"

echo "2. Pushing Prisma schema..."
npx prisma db push --accept-data-loss 2>&1

echo "3. Seeding initial data..."
npx prisma db execute --file prisma/seed.sql 2>&1 || echo "Seed done (may already exist)"

echo "4. Starting application..."
exec node dist/src/index.js
