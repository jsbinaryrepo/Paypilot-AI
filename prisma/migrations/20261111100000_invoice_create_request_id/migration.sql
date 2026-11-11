ALTER TABLE "Invoice" ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX "Invoice_userId_clientRequestId_key" ON "Invoice"("userId", "clientRequestId");
