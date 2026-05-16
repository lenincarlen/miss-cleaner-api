CREATE TABLE IF NOT EXISTS "payment_methods" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "profile_id" UUID NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'cardnet',
  "token" TEXT NOT NULL,
  "cardholder_name" TEXT,
  "brand" TEXT,
  "last4" VARCHAR(4) NOT NULL,
  "exp_month" INTEGER NOT NULL,
  "exp_year" INTEGER NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_methods_profile_id_fkey"
    FOREIGN KEY ("profile_id") REFERENCES "profiles"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_methods_token_key" ON "payment_methods"("token");
CREATE INDEX IF NOT EXISTS "payment_methods_profile_id_idx" ON "payment_methods"("profile_id");
