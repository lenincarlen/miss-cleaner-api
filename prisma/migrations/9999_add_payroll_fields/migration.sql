-- Add payroll flag to institutions
ALTER TABLE "institutions"
  ADD COLUMN IF NOT EXISTS "payroll_deduction_allowed" BOOLEAN NOT NULL DEFAULT TRUE;

-- Add payment mode to profiles (payroll vs self_pay)
ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "payment_mode" TEXT NOT NULL DEFAULT 'payroll';
