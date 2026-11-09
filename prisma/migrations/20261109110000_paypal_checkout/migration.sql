ALTER TABLE "Payment" ADD COLUMN "paypalInvoiceId" TEXT;
CREATE UNIQUE INDEX "Payment_paypalInvoiceId_key" ON "Payment"("paypalInvoiceId");
CREATE TABLE "Checkout" (
 "id" TEXT NOT NULL PRIMARY KEY, "invoiceId" TEXT NOT NULL, "orderId" TEXT,
 "createKey" TEXT NOT NULL, "captureKey" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "busyUntil" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Checkout_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Checkout_invoiceId_key" ON "Checkout"("invoiceId");
CREATE UNIQUE INDEX "Checkout_orderId_key" ON "Checkout"("orderId");
CREATE UNIQUE INDEX "Checkout_createKey_key" ON "Checkout"("createKey");
CREATE UNIQUE INDEX "Checkout_captureKey_key" ON "Checkout"("captureKey");
