-- Packaging photo for catalog drugs. Null everywhere at first: the global
-- register import carries no imagery, clinics fill in what they actually
-- dispense (own photos or the manufacturer's official pack shots).
ALTER TABLE "Drug" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;
