-- CreateTable
CREATE TABLE "owner_distributions" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "owner_distributions_bookingId_idx" ON "owner_distributions"("bookingId");

-- CreateIndex
CREATE INDEX "owner_distributions_paidAt_idx" ON "owner_distributions"("paidAt");

-- CreateIndex
CREATE INDEX "owner_distributions_createdByStaffId_idx" ON "owner_distributions"("createdByStaffId");

-- AddForeignKey
ALTER TABLE "owner_distributions" ADD CONSTRAINT "owner_distributions_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_distributions" ADD CONSTRAINT "owner_distributions_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
