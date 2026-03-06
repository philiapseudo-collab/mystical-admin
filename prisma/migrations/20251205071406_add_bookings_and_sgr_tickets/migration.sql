-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pesapalOrderTrackingId" TEXT,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT,
    "description" TEXT,
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_pesapalOrderTrackingId_key" ON "Order"("pesapalOrderTrackingId");

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "bookingReference" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "guestDetails" JSONB NOT NULL,
    "priceBreakdown" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sgr_tickets" (
    "id" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "trainNumber" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "seatNumber" TEXT NOT NULL,
    "departureTime" TEXT NOT NULL,
    "arrivalTime" TEXT NOT NULL,
    "passengerName" TEXT NOT NULL,
    "qrCode" TEXT NOT NULL,
    "bookingReference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sgr_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_bookingReference_key" ON "bookings"("bookingReference");

-- CreateIndex
CREATE INDEX "bookings_bookingReference_idx" ON "bookings"("bookingReference");

-- CreateIndex
CREATE UNIQUE INDEX "sgr_tickets_ticketNumber_key" ON "sgr_tickets"("ticketNumber");

-- CreateIndex
CREATE INDEX "sgr_tickets_ticketNumber_idx" ON "sgr_tickets"("ticketNumber");

-- CreateIndex
CREATE INDEX "sgr_tickets_bookingReference_idx" ON "sgr_tickets"("bookingReference");
