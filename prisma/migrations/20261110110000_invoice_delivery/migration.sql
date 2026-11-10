CREATE TABLE "InvoiceDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "invoiceId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "sender" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "providerId" TEXT,
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "busyUntil" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" DATETIME,
  CONSTRAINT "InvoiceDelivery_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InvoiceDelivery_invoiceId_key" ON "InvoiceDelivery"("invoiceId");
CREATE UNIQUE INDEX "InvoiceDelivery_idempotencyKey_key" ON "InvoiceDelivery"("idempotencyKey");
CREATE UNIQUE INDEX "InvoiceDelivery_providerId_key" ON "InvoiceDelivery"("providerId");
