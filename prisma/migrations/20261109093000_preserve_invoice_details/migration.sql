-- Preserve the existing editor's line items and notes without changing totals.
ALTER TABLE "Invoice" ADD COLUMN "details" JSONB;
