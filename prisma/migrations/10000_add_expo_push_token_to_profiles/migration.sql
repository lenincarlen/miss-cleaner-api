ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "expo_push_token" VARCHAR(255);
