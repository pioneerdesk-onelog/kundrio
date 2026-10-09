-- Bisherige Farbe als Markenfarbe übernehmen, dann Spalte entfernen
UPDATE "Workspace" SET "brandPrimary" = "color";
ALTER TABLE "Workspace" DROP COLUMN "color";
