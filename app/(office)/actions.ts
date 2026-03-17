'use server';

import { clerkClient } from '@clerk/nextjs/server';
import { DepartureStatus, ExpenseStatus, PackageVisibility, PaymentChannel, Prisma, StaffRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireStaff } from '@/lib/auth';
import { recordAnalyticsEvent } from '@/lib/analytics';
import { getAppUrl } from '@/lib/app-url';
import {
  buildPriceBreakdown,
  buildQuoteLineItems,
  calculateDepositBreakdownFromAmount,
  generateBookingReference,
  generateInvoiceNumber,
  generateQuoteNumber,
  mapInvoiceToBookingStatus,
  roundCurrency,
  type InvoiceType,
  type SupportedCurrency,
} from '@/lib/commerce';
import { uploadImageToCloudinary } from '@/lib/cloudinary';
import { prisma } from '@/lib/prisma';
import { isAllowedStaffDomain, normalizeEmail } from '@/lib/security';

type DbClient = Prisma.TransactionClient | typeof prisma;

export type ManualBookingActionState = {
  error: string | null;
};

const supportedCurrencies = ['KES', 'USD', 'TZS'] as const;
const emptyManualBookingState: ManualBookingActionState = {
  error: null,
};

const lineItemSchema = z.object({
  itemName: z.string().trim().min(1, 'Each sale item needs a name.'),
  quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1.'),
  pricePerUnit: z.coerce.number().positive('Unit price must be greater than 0.'),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  specialRequests: z.string().trim().optional(),
});

const directCostSchema = z.object({
  vendorId: z.string().trim().optional(),
  category: z.string().trim().min(1, 'Each direct cost needs a category.'),
  description: z.string().trim().min(1, 'Each direct cost needs a description.'),
  amount: z.coerce.number().positive('Direct costs must be greater than 0.'),
  notes: z.string().trim().optional(),
});

const ownerDistributionSchema = z.object({
  recipientName: z.string().trim().min(1, 'Each owner distribution needs a recipient name.'),
  amount: z.coerce.number().positive('Owner distribution amounts must be greater than 0.'),
  notes: z.string().trim().optional(),
  paidAt: z.string().trim().optional(),
});

const manualBookingSchema = z.object({
  saleDate: z.string().trim().min(1, 'Sale date is required.'),
  tripTitle: z.string().trim().min(1, 'Journey title is required.'),
  leadFullName: z.string().trim().min(1, 'Lead traveler name is required.'),
  leadEmail: z.string().trim().email('A valid traveler email is required.'),
  leadPhone: z.string().trim().optional(),
  guestCount: z.coerce.number().int().min(1, 'Guest count must be at least 1.'),
  tripNotes: z.string().trim().optional(),
  catalogPackageId: z.string().trim().optional(),
  departureId: z.string().trim().optional(),
  currency: z.enum(supportedCurrencies),
  paymentMode: z.enum(['unpaid', 'deposit', 'fully_paid']),
  depositAmount: z.coerce.number().nonnegative().optional(),
  paymentChannel: z.nativeEnum(PaymentChannel).optional(),
  paymentReference: z.string().trim().optional(),
  paymentNotes: z.string().trim().optional(),
});

function trimValue(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalValue(value: FormDataEntryValue | null) {
  const trimmed = trimValue(value);
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseDateInput(value: string | undefined, fallback = new Date()) {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('One of the provided dates is invalid.');
  }

  return parsed;
}

function splitFullName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || null,
    lastName: parts.slice(1).join(' ') || null,
  };
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-');
}

function parseLines(value: string | undefined) {
  return (value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function generateDepartureCode() {
  return `DEP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

async function resolveUploadedAsset(formData: FormData) {
  const imageUrl = optionalValue(formData.get('imageUrl'));
  const imageAlt = optionalValue(formData.get('imageAlt'));
  const heroImage = formData.get('heroImage');

  if (heroImage instanceof File && heroImage.size > 0) {
    const uploaded = await uploadImageToCloudinary(heroImage);
    return {
      url: uploaded.secureUrl,
      alt: imageAlt || 'Catalog package image',
      cloudinaryPublicId: uploaded.publicId,
    };
  }

  if (imageUrl) {
    return {
      url: imageUrl,
      alt: imageAlt || 'Catalog package image',
      cloudinaryPublicId: null,
    };
  }

  return null;
}

function parseJsonArray<T>(formData: FormData, fieldName: string, schema: z.ZodType<T>) {
  const rawValue = trimValue(formData.get(fieldName));

  if (!rawValue) {
    return [] as T[];
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(rawValue);
  } catch {
    throw new Error(`The ${fieldName} payload is not valid JSON.`);
  }

  if (!Array.isArray(parsedValue)) {
    throw new Error(`The ${fieldName} payload must be an array.`);
  }

  const results = parsedValue.map((item) => schema.safeParse(item));
  const failedResult = results.find((result) => !result.success);

  if (failedResult && !failedResult.success) {
    throw new Error(failedResult.error.issues[0]?.message || `The ${fieldName} payload is invalid.`);
  }

  return results.map((result) => {
    if (!result.success) {
      throw new Error(result.error.issues[0]?.message || `The ${fieldName} payload is invalid.`);
    }

    return result.data;
  });
}

async function writeAuditLog(
  client: DbClient,
  args: {
    actorStaffId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    payload?: Record<string, unknown>;
  }
) {
  await client.auditLog.create({
    data: {
      actorStaffId: args.actorStaffId || null,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      payload: args.payload ? (args.payload as Prisma.InputJsonValue) : undefined,
    },
  });
}

async function ensureSystemAccounts(client: DbClient) {
  const [cashAccount, receivablesAccount, revenueAccount, expenseAccount, ownerDistributionsAccount] = await Promise.all([
    client.ledgerAccount.upsert({
      where: { code: '1000' },
      update: { name: 'Cash on Hand', type: 'ASSET', isSystem: true, isActive: true },
      create: { code: '1000', name: 'Cash on Hand', type: 'ASSET', isSystem: true, isActive: true },
    }),
    client.ledgerAccount.upsert({
      where: { code: '1100' },
      update: { name: 'Accounts Receivable', type: 'ASSET', isSystem: true, isActive: true },
      create: { code: '1100', name: 'Accounts Receivable', type: 'ASSET', isSystem: true, isActive: true },
    }),
    client.ledgerAccount.upsert({
      where: { code: '4000' },
      update: { name: 'Travel Revenue', type: 'REVENUE', isSystem: true, isActive: true },
      create: { code: '4000', name: 'Travel Revenue', type: 'REVENUE', isSystem: true, isActive: true },
    }),
    client.ledgerAccount.upsert({
      where: { code: '5000' },
      update: { name: 'Operating Expenses', type: 'EXPENSE', isSystem: true, isActive: true },
      create: { code: '5000', name: 'Operating Expenses', type: 'EXPENSE', isSystem: true, isActive: true },
    }),
    client.ledgerAccount.upsert({
      where: { code: '3100' },
      update: { name: 'Owner Distributions', type: 'EQUITY', isSystem: true, isActive: true },
      create: { code: '3100', name: 'Owner Distributions', type: 'EQUITY', isSystem: true, isActive: true },
    }),
  ]);

  return {
    cashAccount,
    receivablesAccount,
    revenueAccount,
    expenseAccount,
    ownerDistributionsAccount,
  };
}

async function createJournalEntry(
  client: DbClient,
  args: {
    reference: string;
    source: string;
    memo?: string | null;
    entryDate: Date;
    postedAt?: Date;
    createdByStaffId?: string | null;
    lines: Array<{
      accountId: string;
      debit?: number;
      credit?: number;
      currency: SupportedCurrency;
      description?: string | null;
    }>;
  }
) {
  const totalDebits = roundCurrency(args.lines.reduce((sum, line) => sum + (line.debit || 0), 0));
  const totalCredits = roundCurrency(args.lines.reduce((sum, line) => sum + (line.credit || 0), 0));

  if (totalDebits !== totalCredits) {
    throw new Error('Journal entry is not balanced.');
  }

  return client.journalEntry.create({
    data: {
      reference: args.reference,
      source: args.source,
      memo: args.memo || null,
      entryDate: args.entryDate,
      postedAt: args.postedAt || args.entryDate,
      createdByStaffId: args.createdByStaffId || null,
      lines: {
        create: args.lines.map((line) => ({
          accountId: line.accountId,
          debit: roundCurrency(line.debit || 0),
          credit: roundCurrency(line.credit || 0),
          currency: line.currency,
          description: line.description || null,
        })),
      },
    },
    include: {
      lines: true,
    },
  });
}

async function assertDepartureAvailability(
  client: DbClient,
  args: {
    departureId: string;
    guestsCount: number;
  }
) {
  const departure = await client.departure.findUnique({
    where: { id: args.departureId },
    include: {
      package: true,
      reservations: true,
    },
  });

  if (!departure) {
    throw new Error('Selected departure could not be found.');
  }

  if (departure.status !== 'OPEN') {
    throw new Error('Selected departure is not open for booking.');
  }

  const heldSeats = departure.reservations
    .filter((reservation) => reservation.status === 'HOLD' || reservation.status === 'CONFIRMED')
    .reduce((sum, reservation) => sum + reservation.guestsCount, 0);
  const openSeats = Math.max(departure.capacity - heldSeats, 0);

  if (args.guestsCount > openSeats) {
    throw new Error(
      openSeats > 0
        ? `Only ${openSeats} seat${openSeats === 1 ? '' : 's'} remain on the selected departure.`
        : 'The selected departure is sold out.'
    );
  }

  return departure;
}

async function syncDepartureReservation(
  client: DbClient,
  args: {
    bookingId: string;
    departureId: string;
    guestsCount: number;
    status: 'HOLD' | 'CONFIRMED';
  }
) {
  return client.departureReservation.upsert({
    where: {
      departureId_bookingId: {
        departureId: args.departureId,
        bookingId: args.bookingId,
      },
    },
    update: {
      guestsCount: args.guestsCount,
      status: args.status,
    },
    create: {
      bookingId: args.bookingId,
      departureId: args.departureId,
      guestsCount: args.guestsCount,
      status: args.status,
    },
  });
}

async function createExpenseRecord(
  client: DbClient,
  args: {
    vendorId?: string;
    category: string;
    description: string;
    amount: number;
    currency: SupportedCurrency;
    status: ExpenseStatus;
    incurredAt: Date;
    paidAt?: Date;
    notes?: string;
    bookingId?: string;
    departureId?: string;
    catalogPackageId?: string;
    createdByStaffId?: string | null;
    auditAction?: string;
  }
) {
  const expense = await client.expense.create({
    data: {
      vendorId: args.vendorId || null,
      category: args.category,
      description: args.description,
      amount: roundCurrency(args.amount),
      currency: args.currency,
      status: args.status,
      incurredAt: args.incurredAt,
      paidAt: args.status === 'POSTED' ? args.paidAt || args.incurredAt : null,
      notes: args.notes || null,
      createdByStaffId: args.createdByStaffId || null,
    },
  });

  if (args.bookingId || args.departureId || args.catalogPackageId) {
    await client.expenseAllocation.create({
      data: {
        expenseId: expense.id,
        bookingId: args.bookingId || null,
        departureId: args.departureId || null,
        catalogPackageId: args.catalogPackageId || null,
        amount: roundCurrency(args.amount),
        notes: args.notes || null,
      },
    });
  }

  if (args.status === 'POSTED') {
    const accounts = await ensureSystemAccounts(client);
    await createJournalEntry(client, {
      reference: `EXP-${expense.id.slice(0, 8).toUpperCase()}`,
      source: 'expense.posted',
      memo: args.description,
      entryDate: args.paidAt || args.incurredAt,
      createdByStaffId: args.createdByStaffId,
      lines: [
        {
          accountId: accounts.expenseAccount.id,
          debit: args.amount,
          currency: args.currency,
          description: args.description,
        },
        {
          accountId: accounts.cashAccount.id,
          credit: args.amount,
          currency: args.currency,
          description: args.description,
        },
      ],
    });
  }

  await writeAuditLog(client, {
    actorStaffId: args.createdByStaffId,
    action: args.auditAction || 'expense.created',
    entityType: 'Expense',
    entityId: expense.id,
    payload: {
      amount: roundCurrency(args.amount),
      currency: args.currency,
      status: args.status,
    },
  });

  return expense;
}

async function createInvoiceRecord(
  client: DbClient,
  args: {
    bookingId: string;
    quoteId: string;
    type: InvoiceType;
    amount: number;
    currency: SupportedCurrency;
    dueDate: Date;
    issuedAt: Date;
    createdByStaffId?: string | null;
    bookingReference: string;
    departureId?: string;
  }
) {
  const invoice = await client.invoice.create({
    data: {
      bookingId: args.bookingId,
      quoteId: args.quoteId,
      invoiceNumber: generateInvoiceNumber(args.type),
      type: args.type,
      status: 'issued',
      currency: args.currency,
      totalAmount: roundCurrency(args.amount),
      dueAmount: roundCurrency(args.amount),
      paidAmount: 0,
      dueDate: args.dueDate,
      issuedAt: args.issuedAt,
      metadata: {
        bookingReference: args.bookingReference,
        createdBy: 'manual_admin',
      } as Prisma.InputJsonValue,
      createdAt: args.issuedAt,
    },
  });

  const accounts = await ensureSystemAccounts(client);
  await createJournalEntry(client, {
    reference: `INV-${invoice.invoiceNumber}`,
    source: 'invoice.issued',
    memo: `${args.bookingReference} ${args.type.toLowerCase()} invoice`,
    entryDate: args.issuedAt,
    createdByStaffId: args.createdByStaffId,
    lines: [
      {
        accountId: accounts.receivablesAccount.id,
        debit: args.amount,
        currency: args.currency,
        description: invoice.invoiceNumber,
      },
      {
        accountId: accounts.revenueAccount.id,
        credit: args.amount,
        currency: args.currency,
        description: invoice.invoiceNumber,
      },
    ],
  });

  await recordAnalyticsEvent(client, {
    eventKey: `INVOICE_CREATED:${invoice.id}`,
    eventType: 'INVOICE_CREATED',
    path: '/bookings/new',
    sessionKey: `staff:${args.createdByStaffId || 'system'}`,
    visitorKey: `staff:${args.createdByStaffId || 'system'}`,
    bookingId: args.bookingId,
    departureId: args.departureId,
    metadata: {
      amount: roundCurrency(args.amount),
      currency: args.currency,
      invoiceNumber: invoice.invoiceNumber,
      invoiceType: args.type,
    },
    occurredAt: args.issuedAt,
  });

  await writeAuditLog(client, {
    actorStaffId: args.createdByStaffId,
    action: 'invoice.created',
    entityType: 'Invoice',
    entityId: invoice.id,
    payload: {
      invoiceNumber: invoice.invoiceNumber,
      type: args.type,
      amount: roundCurrency(args.amount),
      currency: args.currency,
    },
  });

  return invoice;
}

async function createManualPaymentRecord(
  client: DbClient,
  args: {
    bookingId: string;
    invoiceId?: string;
    departureId?: string;
    channel: PaymentChannel;
    amount: number;
    currency: SupportedCurrency;
    reference?: string;
    notes?: string;
    receivedAt: Date;
    receivedByStaffId?: string | null;
    path: string;
  }
) {
  const booking = await client.booking.findUnique({
    where: { id: args.bookingId },
    include: {
      departureReservations: true,
    },
  });

  if (!booking) {
    throw new Error('The selected booking could not be found.');
  }

  const invoice = args.invoiceId
    ? await client.invoice.findUnique({
        where: { id: args.invoiceId },
      })
    : null;

  if (invoice && invoice.bookingId !== args.bookingId) {
    throw new Error('The selected invoice does not belong to the selected booking.');
  }

  if (invoice && roundCurrency(args.amount) > roundCurrency(invoice.dueAmount)) {
    throw new Error('Payment amount cannot exceed the remaining invoice balance.');
  }

  const manualPayment = await client.manualPayment.create({
    data: {
      bookingId: args.bookingId,
      invoiceId: args.invoiceId || null,
      departureId: args.departureId || booking.departureId || null,
      channel: args.channel,
      amount: roundCurrency(args.amount),
      currency: args.currency,
      reference: args.reference || null,
      notes: args.notes || null,
      receivedAt: args.receivedAt,
      receivedByStaffId: args.receivedByStaffId || null,
      createdAt: args.receivedAt,
    },
  });

  if (invoice) {
    const nextPaidAmount = roundCurrency(invoice.paidAmount + args.amount);
    const nextDueAmount = roundCurrency(Math.max(invoice.totalAmount - nextPaidAmount, 0));
    const invoiceStatus = nextDueAmount === 0 ? 'paid' : nextPaidAmount > 0 ? 'pending' : invoice.status;
    const paidAt = nextDueAmount === 0 ? args.receivedAt : invoice.paidAt;

    await client.invoice.update({
      where: { id: invoice.id },
      data: {
        status: invoiceStatus,
        paidAmount: nextPaidAmount,
        dueAmount: nextDueAmount,
        paidAt,
      },
    });

    if (nextDueAmount === 0) {
      const mappedStatus = mapInvoiceToBookingStatus(invoice.type === 'DEPOSIT' ? 'DEPOSIT' : 'BALANCE', 'completed');
      await client.booking.update({
        where: { id: args.bookingId },
        data: {
          status: mappedStatus.bookingStatus,
          paymentStatus: mappedStatus.bookingPaymentStatus,
        },
      });
    } else {
      await client.booking.update({
        where: { id: args.bookingId },
        data: {
          status: invoice.type === 'DEPOSIT' ? 'deposit_pending' : 'balance_pending',
          paymentStatus: 'partial',
        },
      });
    }
  }

  const resolvedDepartureId = args.departureId || booking.departureId;
  if (resolvedDepartureId) {
    const reservation = booking.departureReservations.find((item) => item.departureId === resolvedDepartureId);
    const guestsCount = reservation?.guestsCount || 1;

    await syncDepartureReservation(client, {
      bookingId: args.bookingId,
      departureId: resolvedDepartureId,
      guestsCount,
      status: 'CONFIRMED',
    });
  }

  const accounts = await ensureSystemAccounts(client);
  await createJournalEntry(client, {
    reference: `PAY-${manualPayment.id.slice(0, 8).toUpperCase()}`,
    source: 'manual_payment.received',
    memo: args.reference || `${args.channel} payment`,
    entryDate: args.receivedAt,
    createdByStaffId: args.receivedByStaffId,
    lines: [
      {
        accountId: accounts.cashAccount.id,
        debit: args.amount,
        currency: args.currency,
        description: args.reference || args.channel,
      },
      {
        accountId: accounts.receivablesAccount.id,
        credit: args.amount,
        currency: args.currency,
        description: args.reference || args.channel,
      },
    ],
  });

  await recordAnalyticsEvent(client, {
    eventKey: `PAYMENT_COMPLETED:${manualPayment.id}`,
    eventType: 'PAYMENT_COMPLETED',
    path: args.path,
    sessionKey: `staff:${args.receivedByStaffId || 'system'}`,
    visitorKey: `staff:${args.receivedByStaffId || 'system'}`,
    bookingId: args.bookingId,
    departureId: resolvedDepartureId || undefined,
    metadata: {
      amount: roundCurrency(args.amount),
      currency: args.currency,
      channel: args.channel,
    },
    occurredAt: args.receivedAt,
  });

  await writeAuditLog(client, {
    actorStaffId: args.receivedByStaffId,
    action: 'manual_payment.recorded',
    entityType: 'ManualPayment',
    entityId: manualPayment.id,
    payload: {
      amount: roundCurrency(args.amount),
      currency: args.currency,
      channel: args.channel,
      invoiceId: args.invoiceId || null,
    },
  });

  return manualPayment;
}

async function createOwnerDistributionRecord(
  client: DbClient,
  args: {
    bookingId: string;
    recipientName: string;
    amount: number;
    currency: SupportedCurrency;
    paidAt: Date;
    notes?: string;
    createdByStaffId?: string | null;
    bookingReference: string;
  }
) {
  const ownerDistribution = await client.ownerDistribution.create({
    data: {
      bookingId: args.bookingId,
      recipientName: args.recipientName,
      amount: roundCurrency(args.amount),
      currency: args.currency,
      paidAt: args.paidAt,
      notes: args.notes || null,
      createdByStaffId: args.createdByStaffId || null,
      createdAt: args.paidAt,
    },
  });

  const accounts = await ensureSystemAccounts(client);
  await createJournalEntry(client, {
    reference: `DIST-${ownerDistribution.id.slice(0, 8).toUpperCase()}`,
    source: 'owner_distribution.paid',
    memo: `${args.bookingReference} owner distribution`,
    entryDate: args.paidAt,
    createdByStaffId: args.createdByStaffId,
    lines: [
      {
        accountId: accounts.ownerDistributionsAccount.id,
        debit: args.amount,
        currency: args.currency,
        description: args.recipientName,
      },
      {
        accountId: accounts.cashAccount.id,
        credit: args.amount,
        currency: args.currency,
        description: args.recipientName,
      },
    ],
  });

  await writeAuditLog(client, {
    actorStaffId: args.createdByStaffId,
    action: 'owner_distribution.recorded',
    entityType: 'OwnerDistribution',
    entityId: ownerDistribution.id,
    payload: {
      recipientName: args.recipientName,
      amount: roundCurrency(args.amount),
      currency: args.currency,
    },
  });

  return ownerDistribution;
}

export async function upsertCatalogPackageAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'OPS']);

  const packageId = optionalValue(formData.get('packageId'));
  const title = trimValue(formData.get('title'));
  const description = trimValue(formData.get('description'));
  const city = trimValue(formData.get('city'));
  const priceFrom = Number(trimValue(formData.get('priceFrom')));
  const duration = Number(trimValue(formData.get('duration')) || '0');
  const maxGroupSize = Number(trimValue(formData.get('maxGroupSize')) || '0');

  if (!title || !description || !city) {
    throw new Error('Title, description, and city are required.');
  }

  if (!Number.isFinite(priceFrom) || priceFrom < 0) {
    throw new Error('Package price must be zero or greater.');
  }

  const currency = trimValue(formData.get('currency')) as SupportedCurrency;
  if (!supportedCurrencies.includes(currency)) {
    throw new Error('Unsupported package currency.');
  }

  const featured = Boolean(formData.get('featured'));
  const slug = optionalValue(formData.get('slug')) || slugify(title);
  const uploadedAsset = await resolveUploadedAsset(formData);
  let resolvedPackageId = packageId;

  await prisma.$transaction(async (tx) => {
    const existingPackage = packageId
      ? await tx.catalogPackage.findUnique({
          where: { id: packageId },
          include: {
            assets: true,
          },
        })
      : null;

    if (packageId && !existingPackage) {
      throw new Error('The selected package could not be found.');
    }

    const visibilityInput = trimValue(formData.get('visibility')) || existingPackage?.visibility || PackageVisibility.DRAFT;
    const visibility = Object.values(PackageVisibility).includes(visibilityInput as PackageVisibility)
      ? (visibilityInput as PackageVisibility)
      : PackageVisibility.DRAFT;
    const now = new Date();
    const packageData = {
      title,
      slug,
      subtitle: optionalValue(formData.get('subtitle')) || title,
      summary: optionalValue(formData.get('summary')) || null,
      description,
      duration: Math.max(duration || 1, 1),
      maxGroupSize: Math.max(maxGroupSize || 1, 1),
      difficulty: optionalValue(formData.get('difficulty')) || 'Easy',
      priceFrom,
      currency,
      locations: [
        {
          city,
          country: optionalValue(formData.get('country')) || 'Kenya',
        },
      ] as Prisma.InputJsonValue,
      itinerary: [] as Prisma.InputJsonValue,
      inclusions: parseLines(optionalValue(formData.get('inclusions'))) as Prisma.InputJsonValue,
      exclusions: parseLines(optionalValue(formData.get('exclusions'))) as Prisma.InputJsonValue,
      highlights: parseLines(optionalValue(formData.get('highlights'))) as Prisma.InputJsonValue,
      bestSeasons: parseLines(optionalValue(formData.get('bestSeasons'))) as Prisma.InputJsonValue,
      featured,
      visibility,
      publishedAt: visibility === 'PUBLISHED' ? existingPackage?.publishedAt || now : existingPackage?.publishedAt || null,
      archivedAt: visibility === 'ARCHIVED' ? now : null,
    };

    const pkg = packageId
      ? await tx.catalogPackage.update({
          where: { id: packageId },
          data: packageData,
        })
      : await tx.catalogPackage.create({
          data: packageData,
        });

    resolvedPackageId = pkg.id;

    if (uploadedAsset) {
      const existingAssetCount = existingPackage?.assets.length || 0;
      await tx.packageAsset.create({
        data: {
          packageId: pkg.id,
          url: uploadedAsset.url,
          alt: uploadedAsset.alt,
          cloudinaryPublicId: uploadedAsset.cloudinaryPublicId,
          sortOrder: existingAssetCount,
          isPrimary: existingAssetCount === 0,
        },
      });
    }

    await writeAuditLog(tx, {
      actorStaffId: staff.id,
      action: packageId ? 'package.updated' : 'package.created',
      entityType: 'CatalogPackage',
      entityId: pkg.id,
      payload: {
        title,
        visibility,
      },
    });
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });

  revalidatePath('/packages');
  if (resolvedPackageId) {
    revalidatePath(`/packages/${resolvedPackageId}`);
  }
  redirect(resolvedPackageId ? `/packages/${resolvedPackageId}` : '/packages');
}

export async function togglePackageVisibilityAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'OPS']);
  const packageId = trimValue(formData.get('packageId'));
  const visibilityInput = trimValue(formData.get('visibility'));

  if (!packageId || !visibilityInput) {
    throw new Error('Package and target visibility are required.');
  }

  if (!Object.values(PackageVisibility).includes(visibilityInput as PackageVisibility)) {
    throw new Error('Unsupported package visibility.');
  }

  const visibility = visibilityInput as PackageVisibility;

  await prisma.catalogPackage.update({
    where: { id: packageId },
    data: {
      visibility,
      publishedAt: visibility === 'PUBLISHED' ? new Date() : undefined,
      archivedAt: visibility === 'ARCHIVED' ? new Date() : visibility === 'DRAFT' ? null : undefined,
    },
  });

  await writeAuditLog(prisma, {
    actorStaffId: staff.id,
    action: 'package.visibility_changed',
    entityType: 'CatalogPackage',
    entityId: packageId,
    payload: {
      visibility,
    },
  });

  revalidatePath('/packages');
  revalidatePath(`/packages/${packageId}`);
  redirect(`/packages/${packageId}`);
}

export async function setPrimaryPackageAssetAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'OPS']);
  const packageId = trimValue(formData.get('packageId'));
  const assetId = trimValue(formData.get('assetId'));

  if (!packageId || !assetId) {
    throw new Error('Package and asset are required.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.packageAsset.updateMany({
      where: { packageId },
      data: { isPrimary: false },
    });
    await tx.packageAsset.update({
      where: { id: assetId },
      data: { isPrimary: true },
    });

    await writeAuditLog(tx, {
      actorStaffId: staff.id,
      action: 'package_asset.primary_set',
      entityType: 'PackageAsset',
      entityId: assetId,
      payload: {
        packageId,
      },
    });
  });

  revalidatePath(`/packages/${packageId}`);
  redirect(`/packages/${packageId}`);
}

export async function removePackageAssetAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'OPS']);
  const packageId = trimValue(formData.get('packageId'));
  const assetId = trimValue(formData.get('assetId'));

  if (!packageId || !assetId) {
    throw new Error('Package and asset are required.');
  }

  await prisma.$transaction(async (tx) => {
    const asset = await tx.packageAsset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new Error('Package asset not found.');
    }

    await tx.packageAsset.delete({
      where: { id: assetId },
    });

    if (asset.isPrimary) {
      const fallbackAsset = await tx.packageAsset.findFirst({
        where: { packageId },
        orderBy: { sortOrder: 'asc' },
      });

      if (fallbackAsset) {
        await tx.packageAsset.update({
          where: { id: fallbackAsset.id },
          data: { isPrimary: true },
        });
      }
    }

    await writeAuditLog(tx, {
      actorStaffId: staff.id,
      action: 'package_asset.removed',
      entityType: 'PackageAsset',
      entityId: assetId,
      payload: {
        packageId,
      },
    });
  });

  revalidatePath(`/packages/${packageId}`);
  redirect(`/packages/${packageId}`);
}

export async function createDepartureAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'OPS']);
  const packageId = trimValue(formData.get('packageId'));
  const startDateValue = optionalValue(formData.get('startDate'));
  const endDateValue = optionalValue(formData.get('endDate'));
  const capacity = Number(trimValue(formData.get('capacity')) || '0');
  const pricePerPersonValue = optionalValue(formData.get('pricePerPerson'));
  const depositPercentage = Number(trimValue(formData.get('depositPercentage')) || '30');
  const currency = trimValue(formData.get('currency')) as SupportedCurrency;
  const statusInput = trimValue(formData.get('status')) || DepartureStatus.OPEN;

  if (!packageId || !startDateValue || !endDateValue) {
    throw new Error('Package, start date, and end date are required.');
  }

  if (!Object.values(DepartureStatus).includes(statusInput as DepartureStatus)) {
    throw new Error('Unsupported departure status.');
  }

  if (!supportedCurrencies.includes(currency)) {
    throw new Error('Unsupported departure currency.');
  }

  if (!Number.isFinite(capacity) || capacity < 1) {
    throw new Error('Departure capacity must be at least 1.');
  }

  const startDate = parseDateInput(startDateValue);
  const endDate = parseDateInput(endDateValue);
  if (endDate < startDate) {
    throw new Error('Departure end date must be on or after the start date.');
  }

  const departure = await prisma.departure.create({
    data: {
      packageId,
      name: optionalValue(formData.get('name')) || null,
      code: optionalValue(formData.get('code')) || generateDepartureCode(),
      startDate,
      endDate,
      capacity,
      status: statusInput as DepartureStatus,
      pricePerPerson: pricePerPersonValue ? Number(pricePerPersonValue) : null,
      currency,
      depositPercentage: Math.min(Math.max(depositPercentage || 30, 1), 100),
      notes: optionalValue(formData.get('notes')) || null,
    },
  });

  await writeAuditLog(prisma, {
    actorStaffId: staff.id,
    action: 'departure.created',
    entityType: 'Departure',
    entityId: departure.id,
    payload: {
      code: departure.code,
      packageId,
    },
  });

  revalidatePath('/departures');
  revalidatePath(`/packages/${packageId}`);
  redirect('/departures');
}

export async function updateDepartureStatusAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'OPS']);
  const departureId = trimValue(formData.get('departureId'));
  const statusInput = trimValue(formData.get('status'));

  if (!departureId || !statusInput) {
    throw new Error('Departure and target status are required.');
  }

  if (!Object.values(DepartureStatus).includes(statusInput as DepartureStatus)) {
    throw new Error('Unsupported departure status.');
  }

  const status = statusInput as DepartureStatus;

  const departure = await prisma.departure.update({
    where: { id: departureId },
    data: {
      status,
    },
  });

  await writeAuditLog(prisma, {
    actorStaffId: staff.id,
    action: 'departure.status_changed',
    entityType: 'Departure',
    entityId: departureId,
    payload: {
      status,
    },
  });

  revalidatePath('/departures');
  revalidatePath(`/packages/${departure.packageId}`);
  redirect('/departures');
}

export async function createStaffAccessAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN']);

  const email = normalizeEmail(trimValue(formData.get('email')));
  if (!email) {
    throw new Error('Staff email is required.');
  }

  if (!isAllowedStaffDomain(email)) {
    throw new Error('This email domain is not allowed for staff access.');
  }

  const roleInput = trimValue(formData.get('role')) || StaffRole.OPS;
  const active = Boolean(formData.get('active'));
  const sendInvite = Boolean(formData.get('sendInvite'));

  if (!Object.values(StaffRole).includes(roleInput as StaffRole)) {
    throw new Error('Unsupported staff role.');
  }

  const role = roleInput as StaffRole;

  const staffUser = await prisma.staffUser.upsert({
    where: {
      email,
    },
    update: {
      fullName: optionalValue(formData.get('fullName')) || null,
      role,
      active,
    },
    create: {
      email,
      fullName: optionalValue(formData.get('fullName')) || null,
      role,
      active,
    },
  });

  if (active && sendInvite) {
    const client = await clerkClient();
    await client.invitations.createInvitation({
      emailAddress: email,
      ignoreExisting: true,
      notify: true,
      redirectUrl: `${getAppUrl()}/sign-up`,
      publicMetadata: {
        staffRole: role,
      },
    });
  }

  await writeAuditLog(prisma, {
    actorStaffId: staff.id,
    action: 'staff.access_upserted',
    entityType: 'StaffUser',
    entityId: staffUser.id,
    payload: {
      email,
      role,
      active,
      sendInvite,
    },
  });

  revalidatePath('/staff');
  redirect('/staff');
}

export async function createVendorAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'FINANCE']);

  const name = trimValue(formData.get('name'));
  if (!name) {
    throw new Error('Vendor name is required.');
  }

  const vendor = await prisma.vendor.create({
    data: {
      name,
      email: optionalValue(formData.get('email')) || null,
      phone: optionalValue(formData.get('phone')) || null,
      notes: optionalValue(formData.get('notes')) || null,
    },
  });

  await writeAuditLog(prisma, {
    actorStaffId: staff.id,
    action: 'vendor.created',
    entityType: 'Vendor',
    entityId: vendor.id,
    payload: {
      name,
    },
  });

  revalidatePath('/finance');
  redirect('/finance');
}

export async function createExpenseAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'FINANCE']);

  const amount = Number(trimValue(formData.get('amount')));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Expense amount must be greater than 0.');
  }

  const currency = trimValue(formData.get('currency')) as SupportedCurrency;
  if (!supportedCurrencies.includes(currency)) {
    throw new Error('Unsupported expense currency.');
  }

  await prisma.$transaction(async (tx) => {
    await createExpenseRecord(tx, {
      vendorId: optionalValue(formData.get('vendorId')),
      category: trimValue(formData.get('category')) || 'Operations',
      description: trimValue(formData.get('description')),
      amount,
      currency,
      status: trimValue(formData.get('status')) === 'DRAFT' ? 'DRAFT' : 'POSTED',
      incurredAt: parseDateInput(optionalValue(formData.get('incurredAt'))),
      paidAt: parseDateInput(optionalValue(formData.get('incurredAt'))),
      notes: optionalValue(formData.get('notes')),
      bookingId: optionalValue(formData.get('bookingId')),
      departureId: optionalValue(formData.get('departureId')),
      catalogPackageId: optionalValue(formData.get('catalogPackageId')),
      createdByStaffId: staff.id,
    });
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });

  revalidatePath('/finance');
  revalidatePath('/dashboard');
  revalidatePath('/bookings');
  redirect('/finance');
}

export async function recordManualPaymentAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'FINANCE']);

  const amount = Number(trimValue(formData.get('amount')));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Payment amount must be greater than 0.');
  }

  const currency = trimValue(formData.get('currency')) as SupportedCurrency;
  if (!supportedCurrencies.includes(currency)) {
    throw new Error('Unsupported payment currency.');
  }

  const paymentChannel = trimValue(formData.get('channel')) as PaymentChannel;
  if (!Object.values(PaymentChannel).includes(paymentChannel)) {
    throw new Error('Unsupported payment channel.');
  }

  const bookingId = trimValue(formData.get('bookingId'));
  if (!bookingId) {
    throw new Error('Booking is required.');
  }

  await prisma.$transaction(async (tx) => {
    await createManualPaymentRecord(tx, {
      bookingId,
      invoiceId: optionalValue(formData.get('invoiceId')),
      departureId: optionalValue(formData.get('departureId')),
      channel: paymentChannel,
      amount,
      currency,
      reference: optionalValue(formData.get('reference')),
      notes: optionalValue(formData.get('notes')),
      receivedAt: parseDateInput(optionalValue(formData.get('receivedAt'))),
      receivedByStaffId: staff.id,
      path: '/finance',
    });
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });

  revalidatePath('/finance');
  revalidatePath('/dashboard');
  revalidatePath('/bookings');
  redirect('/finance');
}

export async function createManualBookingAction(
  previousState: ManualBookingActionState = emptyManualBookingState,
  formData: FormData
): Promise<ManualBookingActionState> {
  const { staff } = await requireStaff(['ADMIN']);
  let bookingReference = '';
  void previousState;

  try {
    const parsedInput = manualBookingSchema.parse({
      saleDate: trimValue(formData.get('saleDate')),
      tripTitle: trimValue(formData.get('tripTitle')),
      leadFullName: trimValue(formData.get('leadFullName')),
      leadEmail: trimValue(formData.get('leadEmail')),
      leadPhone: optionalValue(formData.get('leadPhone')),
      guestCount: trimValue(formData.get('guestCount')),
      tripNotes: optionalValue(formData.get('tripNotes')),
      catalogPackageId: optionalValue(formData.get('catalogPackageId')),
      departureId: optionalValue(formData.get('departureId')),
      currency: trimValue(formData.get('currency')),
      paymentMode: trimValue(formData.get('paymentMode')),
      depositAmount: optionalValue(formData.get('depositAmount')),
      paymentChannel: optionalValue(formData.get('paymentChannel')),
      paymentReference: optionalValue(formData.get('paymentReference')),
      paymentNotes: optionalValue(formData.get('paymentNotes')),
    });

    const items = parseJsonArray(formData, 'itemsJson', lineItemSchema);
    const directCosts = parseJsonArray(formData, 'directCostsJson', directCostSchema);
    const ownerDistributions = parseJsonArray(formData, 'ownerDistributionsJson', ownerDistributionSchema);
    const paymentReceivedNow = trimValue(formData.get('paymentReceivedNow')) === 'true';

    if (items.length === 0) {
      return { error: 'Add at least one sale line item before saving the booking.' };
    }

    const saleDate = parseDateInput(parsedInput.saleDate);
    const normalizedItems = items.map((item, index) => {
      const itemName = item.itemName.trim() || (index === 0 ? parsedInput.tripTitle : `Line item ${index + 1}`);
      const subtotal = roundCurrency(item.quantity * item.pricePerUnit);

      return {
        type: parsedInput.catalogPackageId && index === 0 ? 'package' : 'manual',
        itemName,
        quantity: item.quantity,
        pricePerUnit: roundCurrency(item.pricePerUnit),
        subtotal,
        dateFrom: item.dateFrom || undefined,
        dateTo: item.dateTo || undefined,
        specialRequests: item.specialRequests || undefined,
      };
    });

    const totalAmount = roundCurrency(normalizedItems.reduce((sum, item) => sum + item.subtotal, 0));
    if (totalAmount <= 0) {
      return { error: 'Booking total must be greater than zero.' };
    }

    if (parsedInput.paymentMode === 'deposit') {
      const depositAmount = roundCurrency(parsedInput.depositAmount || 0);
      if (depositAmount <= 0 || depositAmount >= totalAmount) {
        return { error: 'Deposit amount must be greater than zero and smaller than the total booking amount.' };
      }
    }

    if ((parsedInput.paymentMode === 'deposit' && paymentReceivedNow) || parsedInput.paymentMode === 'fully_paid') {
      if (!parsedInput.paymentChannel) {
        return { error: 'Choose how the received payment came in.' };
      }
    }

    const directCostTotal = roundCurrency(directCosts.reduce((sum, item) => sum + item.amount, 0));
    const ownerDistributionTotal = roundCurrency(ownerDistributions.reduce((sum, item) => sum + item.amount, 0));
    const distributableAmount = roundCurrency(totalAmount - directCostTotal);

    if (ownerDistributionTotal > Math.max(distributableAmount, 0)) {
      return { error: 'Owner distributions cannot exceed revenue minus direct booking costs.' };
    }

    bookingReference = await prisma.$transaction(async (tx) => {
      const departure = parsedInput.departureId
        ? await assertDepartureAvailability(tx, {
            departureId: parsedInput.departureId,
            guestsCount: parsedInput.guestCount,
          })
        : null;

      if (departure && parsedInput.catalogPackageId && departure.packageId !== parsedInput.catalogPackageId) {
        throw new Error('The selected departure does not belong to the chosen package.');
      }

      const linkedPackage = parsedInput.catalogPackageId
        ? await tx.catalogPackage.findUnique({
            where: { id: parsedInput.catalogPackageId },
          })
        : departure?.package || null;

      if (parsedInput.catalogPackageId && !linkedPackage) {
        throw new Error('The selected package could not be found.');
      }

      const resolvedPackageId = linkedPackage?.id || null;
      const resolvedDepartureId = departure?.id || null;
      const bookingReferenceValue = generateBookingReference();
      const bookingItems = normalizedItems.map((item, index) => ({
        ...item,
        itemId: resolvedPackageId && index === 0 ? resolvedPackageId : undefined,
        catalogPackageId: resolvedPackageId || undefined,
        departureId: resolvedDepartureId || undefined,
      }));

      const priceBreakdown = buildPriceBreakdown(totalAmount, parsedInput.currency);
      const depositBreakdown =
        parsedInput.paymentMode === 'deposit'
          ? calculateDepositBreakdownFromAmount(totalAmount, parsedInput.depositAmount || 0)
          : {
              depositPercentage: 0,
              depositAmount: 0,
              balanceAmount: totalAmount,
            };

      const booking = await tx.booking.create({
        data: {
          bookingReference: bookingReferenceValue,
          channel: 'manual',
          catalogPackageId: resolvedPackageId,
          departureId: resolvedDepartureId,
          items: bookingItems as unknown as Prisma.InputJsonValue,
          guestDetails: {
            tripTitle: parsedInput.tripTitle,
            fullName: parsedInput.leadFullName,
            email: parsedInput.leadEmail,
            phone: parsedInput.leadPhone || '',
            guestCount: parsedInput.guestCount,
            notes: parsedInput.tripNotes || '',
          } as Prisma.InputJsonValue,
          priceBreakdown: priceBreakdown as unknown as Prisma.InputJsonValue,
          status: parsedInput.paymentMode === 'deposit' ? 'deposit_pending' : 'balance_pending',
          paymentStatus: parsedInput.paymentMode === 'deposit' ? 'deposit_due' : 'balance_due',
          createdAt: saleDate,
        },
      });

      const leadName = splitFullName(parsedInput.leadFullName);
      const lead = await tx.lead.create({
        data: {
          source: 'MANUAL',
          status: 'NEW',
          firstName: leadName.firstName,
          lastName: leadName.lastName,
          fullName: parsedInput.leadFullName,
          email: parsedInput.leadEmail,
          phone: parsedInput.leadPhone || null,
          subject: parsedInput.tripTitle,
          destination: linkedPackage?.title || parsedInput.tripTitle,
          travelers: parsedInput.guestCount,
          travelStart: departure?.startDate || null,
          message: parsedInput.tripNotes || null,
          preferences: {
            entrySource: 'manual_admin',
          } as Prisma.InputJsonValue,
          bookingId: booking.id,
          createdAt: saleDate,
        },
      });

      const quote = await tx.quote.create({
        data: {
          bookingId: booking.id,
          quoteNumber: generateQuoteNumber(),
          status: 'approved',
          currency: parsedInput.currency,
          totalAmount,
          depositPercentage: depositBreakdown.depositPercentage,
          depositAmount: depositBreakdown.depositAmount,
          balanceAmount: depositBreakdown.balanceAmount,
          lineItems: buildQuoteLineItems(bookingItems) as unknown as Prisma.InputJsonValue,
          notes: parsedInput.tripNotes || null,
          approvedAt: saleDate,
          expiresAt: new Date(saleDate.getTime() + 14 * 24 * 60 * 60 * 1000),
          createdAt: saleDate,
        },
      });

      if (resolvedDepartureId) {
        await syncDepartureReservation(tx, {
          bookingId: booking.id,
          departureId: resolvedDepartureId,
          guestsCount: parsedInput.guestCount,
          status: parsedInput.paymentMode === 'unpaid' || (parsedInput.paymentMode === 'deposit' && !paymentReceivedNow) ? 'HOLD' : 'CONFIRMED',
        });
      }

      const invoices: Array<{ id: string }> = [];
      if (parsedInput.paymentMode === 'deposit') {
        invoices.push(
          await createInvoiceRecord(tx, {
            bookingId: booking.id,
            quoteId: quote.id,
            type: 'DEPOSIT',
            amount: depositBreakdown.depositAmount,
            currency: parsedInput.currency,
            dueDate: saleDate,
            issuedAt: saleDate,
            createdByStaffId: staff.id,
            bookingReference: bookingReferenceValue,
            departureId: resolvedDepartureId || undefined,
          })
        );
        invoices.push(
          await createInvoiceRecord(tx, {
            bookingId: booking.id,
            quoteId: quote.id,
            type: 'BALANCE',
            amount: depositBreakdown.balanceAmount,
            currency: parsedInput.currency,
            dueDate: departure?.startDate || saleDate,
            issuedAt: saleDate,
            createdByStaffId: staff.id,
            bookingReference: bookingReferenceValue,
            departureId: resolvedDepartureId || undefined,
          })
        );
      } else {
        invoices.push(
          await createInvoiceRecord(tx, {
            bookingId: booking.id,
            quoteId: quote.id,
            type: 'BALANCE',
            amount: totalAmount,
            currency: parsedInput.currency,
            dueDate: saleDate,
            issuedAt: saleDate,
            createdByStaffId: staff.id,
            bookingReference: bookingReferenceValue,
            departureId: resolvedDepartureId || undefined,
          })
        );
      }

      if (parsedInput.paymentMode === 'deposit' && paymentReceivedNow) {
        await createManualPaymentRecord(tx, {
          bookingId: booking.id,
          invoiceId: invoices[0]?.id,
          departureId: resolvedDepartureId || undefined,
          channel: parsedInput.paymentChannel || PaymentChannel.BANK_TRANSFER,
          amount: depositBreakdown.depositAmount,
          currency: parsedInput.currency,
          reference: parsedInput.paymentReference,
          notes: parsedInput.paymentNotes,
          receivedAt: saleDate,
          receivedByStaffId: staff.id,
          path: '/bookings/new',
        });
      }

      if (parsedInput.paymentMode === 'fully_paid') {
        await createManualPaymentRecord(tx, {
          bookingId: booking.id,
          invoiceId: invoices[0]?.id,
          departureId: resolvedDepartureId || undefined,
          channel: parsedInput.paymentChannel || PaymentChannel.BANK_TRANSFER,
          amount: totalAmount,
          currency: parsedInput.currency,
          reference: parsedInput.paymentReference,
          notes: parsedInput.paymentNotes,
          receivedAt: saleDate,
          receivedByStaffId: staff.id,
          path: '/bookings/new',
        });
      }

      for (const cost of directCosts) {
        await createExpenseRecord(tx, {
          vendorId: cost.vendorId || undefined,
          category: cost.category,
          description: cost.description,
          amount: cost.amount,
          currency: parsedInput.currency,
          status: ExpenseStatus.POSTED,
          incurredAt: saleDate,
          paidAt: saleDate,
          notes: cost.notes,
          bookingId: booking.id,
          departureId: resolvedDepartureId || undefined,
          catalogPackageId: resolvedPackageId || undefined,
          createdByStaffId: staff.id,
          auditAction: 'booking_direct_cost.created',
        });
      }

      for (const distribution of ownerDistributions) {
        await createOwnerDistributionRecord(tx, {
          bookingId: booking.id,
          recipientName: distribution.recipientName,
          amount: distribution.amount,
          currency: parsedInput.currency,
          paidAt: parseDateInput(distribution.paidAt, saleDate),
          notes: distribution.notes,
          createdByStaffId: staff.id,
          bookingReference: bookingReferenceValue,
        });
      }

      await writeAuditLog(tx, {
        actorStaffId: staff.id,
        action: 'lead.created',
        entityType: 'Lead',
        entityId: lead.id,
        payload: {
          email: parsedInput.leadEmail,
          source: 'MANUAL',
        },
      });

      await writeAuditLog(tx, {
        actorStaffId: staff.id,
        action: 'quote.created',
        entityType: 'Quote',
        entityId: quote.id,
        payload: {
          quoteNumber: quote.quoteNumber,
          totalAmount,
          currency: parsedInput.currency,
        },
      });

      await writeAuditLog(tx, {
        actorStaffId: staff.id,
        action: 'booking.manual_created',
        entityType: 'Booking',
        entityId: booking.id,
        payload: {
          bookingReference: bookingReferenceValue,
          guestCount: parsedInput.guestCount,
          totalAmount,
          currency: parsedInput.currency,
          paymentMode: parsedInput.paymentMode,
        },
      });

      return bookingReferenceValue;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        error: error.issues[0]?.message || 'Please review the booking form and try again.',
      };
    }

    return {
      error: error instanceof Error ? error.message : 'Unable to save the manual booking right now.',
    };
  }

  revalidatePath('/dashboard');
  revalidatePath('/bookings');
  revalidatePath('/finance');
  redirect(`/bookings?created=${encodeURIComponent(bookingReference)}`);
}
