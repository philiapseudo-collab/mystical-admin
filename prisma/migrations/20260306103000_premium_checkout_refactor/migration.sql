-- Drop legacy payment source of truth
DROP TABLE IF EXISTS "Order" CASCADE;

-- Bring bookings in line with the deposit-first lifecycle
ALTER TABLE "bookings"
ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'website';

ALTER TABLE "bookings"
ALTER COLUMN "status" SET DEFAULT 'inquiry';

UPDATE "bookings"
SET "status" = 'inquiry'
WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "bookings_status_idx" ON "bookings"("status");

-- CRM leads
CREATE TABLE IF NOT EXISTS "leads" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'CONTACT',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "firstName" TEXT,
    "lastName" TEXT,
    "fullName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "subject" TEXT,
    "destination" TEXT,
    "travelType" TEXT,
    "travelers" INTEGER,
    "travelStart" TIMESTAMP(3),
    "message" TEXT,
    "preferences" JSONB,
    "metadata" JSONB,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "leads_bookingId_key" ON "leads"("bookingId");
CREATE INDEX IF NOT EXISTS "leads_source_idx" ON "leads"("source");
CREATE INDEX IF NOT EXISTS "leads_status_idx" ON "leads"("status");
CREATE INDEX IF NOT EXISTS "leads_email_idx" ON "leads"("email");

ALTER TABLE "leads"
ADD CONSTRAINT "leads_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Quotes
CREATE TABLE IF NOT EXISTS "quotes" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'quoted',
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "depositPercentage" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "depositAmount" DOUBLE PRECISION NOT NULL,
    "balanceAmount" DOUBLE PRECISION NOT NULL,
    "lineItems" JSONB NOT NULL,
    "notes" TEXT,
    "expiresAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "quotes_quoteNumber_key" ON "quotes"("quoteNumber");
CREATE INDEX IF NOT EXISTS "quotes_bookingId_idx" ON "quotes"("bookingId");
CREATE INDEX IF NOT EXISTS "quotes_quoteNumber_idx" ON "quotes"("quoteNumber");
CREATE INDEX IF NOT EXISTS "quotes_status_idx" ON "quotes"("status");

ALTER TABLE "quotes"
ADD CONSTRAINT "quotes_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invoices
CREATE TABLE IF NOT EXISTS "invoices" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DEPOSIT',
    "status" TEXT NOT NULL DEFAULT 'issued',
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "dueAmount" DOUBLE PRECISION NOT NULL,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");
CREATE INDEX IF NOT EXISTS "invoices_quoteId_idx" ON "invoices"("quoteId");
CREATE INDEX IF NOT EXISTS "invoices_bookingId_idx" ON "invoices"("bookingId");
CREATE INDEX IF NOT EXISTS "invoices_invoiceNumber_idx" ON "invoices"("invoiceNumber");
CREATE INDEX IF NOT EXISTS "invoices_status_idx" ON "invoices"("status");

ALTER TABLE "invoices"
ADD CONSTRAINT "invoices_quoteId_fkey"
FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoices"
ADD CONSTRAINT "invoices_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Payment attempts
CREATE TABLE IF NOT EXISTS "payment_attempts" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'PESAPAL',
    "status" TEXT NOT NULL DEFAULT 'created',
    "merchantReference" TEXT NOT NULL,
    "trackingId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "paymentMethod" TEXT,
    "paymentAccount" TEXT,
    "redirectUrl" TEXT,
    "callbackUrl" TEXT,
    "rawRequest" JSONB,
    "rawResponse" JSONB,
    "providerStatusCode" TEXT,
    "providerStatusDescription" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_attempts_merchantReference_key" ON "payment_attempts"("merchantReference");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_attempts_trackingId_key" ON "payment_attempts"("trackingId");
CREATE INDEX IF NOT EXISTS "payment_attempts_bookingId_idx" ON "payment_attempts"("bookingId");
CREATE INDEX IF NOT EXISTS "payment_attempts_invoiceId_idx" ON "payment_attempts"("invoiceId");
CREATE INDEX IF NOT EXISTS "payment_attempts_merchantReference_idx" ON "payment_attempts"("merchantReference");
CREATE INDEX IF NOT EXISTS "payment_attempts_trackingId_idx" ON "payment_attempts"("trackingId");
CREATE INDEX IF NOT EXISTS "payment_attempts_status_idx" ON "payment_attempts"("status");

ALTER TABLE "payment_attempts"
ADD CONSTRAINT "payment_attempts_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_attempts"
ADD CONSTRAINT "payment_attempts_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Payment events
CREATE TABLE IF NOT EXISTS "payment_events" (
    "id" TEXT NOT NULL,
    "paymentAttemptId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'PESAPAL',
    "eventType" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_events_eventKey_key" ON "payment_events"("eventKey");
CREATE INDEX IF NOT EXISTS "payment_events_paymentAttemptId_idx" ON "payment_events"("paymentAttemptId");
CREATE INDEX IF NOT EXISTS "payment_events_eventType_idx" ON "payment_events"("eventType");

ALTER TABLE "payment_events"
ADD CONSTRAINT "payment_events_paymentAttemptId_fkey"
FOREIGN KEY ("paymentAttemptId") REFERENCES "payment_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
