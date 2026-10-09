-- Nachtrag: Diese Spalten waren außerhalb einer Migration angelegt worden.
-- IF NOT EXISTS: auf bestehenden DBs wirkungslos, auf frischen DBs korrekt.
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "attributes" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Pipeline" ADD COLUMN IF NOT EXISTS "externalRef" TEXT;
