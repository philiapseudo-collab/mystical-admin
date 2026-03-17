import type { Prisma, PrismaClient } from '@prisma/client';

type AnalyticsEventType =
  | 'VISIT'
  | 'PAGE_VIEW'
  | 'PACKAGE_VIEW'
  | 'INQUIRY_START'
  | 'CHECKOUT_START'
  | 'INVOICE_CREATED'
  | 'PAYMENT_COMPLETED';

type AnalyticsEventInput = {
  eventKey?: string;
  eventType: AnalyticsEventType;
  path?: string;
  sessionKey: string;
  visitorKey?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  packageId?: string;
  departureId?: string;
  bookingId?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
};

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

function dayStart(date: Date) {
  const normalized = new Date(date);
  normalized.setUTCHours(0, 0, 0, 0);
  return normalized;
}

function dayKey(date: Date) {
  return dayStart(date).toISOString().slice(0, 10);
}

function resolveEventKey(event: AnalyticsEventInput, occurredAt: Date) {
  if (event.eventType === 'VISIT' && event.visitorKey) {
    return `VISIT:${event.visitorKey}:${dayKey(occurredAt)}`;
  }

  if (event.eventKey) {
    return event.eventKey;
  }

  return [
    event.eventType,
    event.visitorKey || 'anonymous',
    event.sessionKey,
    event.packageId || 'none',
    event.departureId || 'none',
    event.bookingId || 'none',
    event.path || 'unknown',
    occurredAt.toISOString(),
  ].join(':');
}

function snapshotDelta(event: AnalyticsEventInput) {
  const amount =
    event.eventType === 'PAYMENT_COMPLETED' && typeof event.metadata?.amount === 'number'
      ? event.metadata.amount
      : 0;

  return {
    visitors: event.eventType === 'VISIT' ? 1 : 0,
    visits: event.eventType === 'VISIT' ? 1 : 0,
    pageViews: event.eventType === 'PAGE_VIEW' ? 1 : 0,
    packageViews: event.eventType === 'PACKAGE_VIEW' ? 1 : 0,
    inquiryStarts: event.eventType === 'INQUIRY_START' ? 1 : 0,
    checkoutStarts: event.eventType === 'CHECKOUT_START' ? 1 : 0,
    invoicesCreated: event.eventType === 'INVOICE_CREATED' ? 1 : 0,
    paymentsCompleted: event.eventType === 'PAYMENT_COMPLETED' ? 1 : 0,
    revenueAmount: amount,
  };
}

export async function recordAnalyticsEvent(client: PrismaClient | TransactionClient, event: AnalyticsEventInput) {
  const occurredAt = event.occurredAt || new Date();
  const resolvedEventKey = resolveEventKey(event, occurredAt);

  const existingEvent = await client.analyticsEvent.findUnique({
    where: {
      eventKey: resolvedEventKey,
    },
  });

  if (existingEvent) {
    return existingEvent;
  }

  const createdEvent = await client.analyticsEvent.create({
    data: {
      eventKey: resolvedEventKey,
      eventType: event.eventType,
      path: event.path,
      sessionKey: event.sessionKey,
      visitorKey: event.visitorKey,
      referrer: event.referrer,
      utmSource: event.utmSource,
      utmMedium: event.utmMedium,
      utmCampaign: event.utmCampaign,
      packageId: event.packageId,
      departureId: event.departureId,
      bookingId: event.bookingId,
      metadata: (event.metadata || {}) as Prisma.InputJsonValue,
      occurredAt,
    },
  });

  const delta = snapshotDelta(event);
  await client.dailyAnalyticsSnapshot.upsert({
    where: {
      date: dayStart(occurredAt),
    },
    update: {
      visitors: { increment: delta.visitors },
      visits: { increment: delta.visits },
      pageViews: { increment: delta.pageViews },
      packageViews: { increment: delta.packageViews },
      inquiryStarts: { increment: delta.inquiryStarts },
      checkoutStarts: { increment: delta.checkoutStarts },
      invoicesCreated: { increment: delta.invoicesCreated },
      paymentsCompleted: { increment: delta.paymentsCompleted },
      revenueAmount: { increment: delta.revenueAmount },
    },
    create: {
      date: dayStart(occurredAt),
      visitors: delta.visitors,
      visits: delta.visits,
      pageViews: delta.pageViews,
      packageViews: delta.packageViews,
      inquiryStarts: delta.inquiryStarts,
      checkoutStarts: delta.checkoutStarts,
      invoicesCreated: delta.invoicesCreated,
      paymentsCompleted: delta.paymentsCompleted,
      revenueAmount: delta.revenueAmount,
      currency:
        typeof event.metadata?.currency === 'string' && event.metadata.currency.length > 0
          ? event.metadata.currency
          : 'KES',
      metadata: {} as Prisma.InputJsonValue,
    },
  });

  return createdEvent;
}
