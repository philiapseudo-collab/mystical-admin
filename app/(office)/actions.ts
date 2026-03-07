'use server';

import { revalidatePath } from 'next/cache';
import { clerkClient } from '@clerk/nextjs/server';
import { Prisma, type PaymentChannel, type StaffRole } from '@prisma/client';
import { requireStaff } from '@/lib/auth';
import { uploadImageToCloudinary } from '@/lib/cloudinary';
import { prisma } from '@/lib/prisma';
import { isAllowedStaffDomain, normalizeEmail } from '@/lib/security';

function parseText(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseNumber(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(parseText(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseList(value: FormDataEntryValue | null) {
  return parseText(value)
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function toDate(value: FormDataEntryValue | null) {
  const text = parseText(value);
  return text ? new Date(text) : null;
}

async function inviteStaffUser(email: string, role: StaffRole) {
  const client = await clerkClient();
  const existingUsers = await client.users.getUserList({
    emailAddress: [email],
    limit: 1,
  });

  if (existingUsers.totalCount > 0) {
    return {
      status: 'existing-user' as const,
    };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';
  const invitation = await client.invitations.createInvitation({
    emailAddress: email,
    redirectUrl: `${appUrl}/sign-up`,
    ignoreExisting: true,
    publicMetadata: {
      staffRole: role,
      source: 'mystical-admin',
    },
  });

  return {
    status: 'invited' as const,
    invitationId: invitation.id,
  };
}

async function writeAuditLog(staffId: string, action: string, entityType: string, entityId: string, payload?: Prisma.JsonValue) {
  await prisma.auditLog.create({
    data: {
      actorStaffId: staffId,
      action,
      entityType,
      entityId,
      ...(payload !== undefined ? { payload: payload as Prisma.InputJsonValue } : {}),
    },
  });
}

async function ensureSystemAccounts() {
  await prisma.ledgerAccount.createMany({
    data: [
      { code: '1000', name: 'Cash on Hand', type: 'ASSET', isSystem: true },
      { code: '1100', name: 'Bank Account', type: 'ASSET', isSystem: true },
      { code: '1200', name: 'Accounts Receivable', type: 'ASSET', isSystem: true },
      { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', isSystem: true },
      { code: '4000', name: 'Travel Revenue', type: 'REVENUE', isSystem: true },
      { code: '6100', name: 'Operating Expenses', type: 'EXPENSE', isSystem: true },
    ],
    skipDuplicates: true,
  });
}

async function createJournalEntry(args: {
  createdByStaffId: string;
  reference?: string;
  source: string;
  memo?: string;
  lines: Array<{
    accountCode: string;
    debit?: number;
    credit?: number;
    currency: string;
    description?: string;
  }>;
}) {
  await ensureSystemAccounts();

  const accounts = await prisma.ledgerAccount.findMany({
    where: {
      code: {
        in: args.lines.map((line) => line.accountCode),
      },
    },
  });

  const accountMap = new Map(accounts.map((account) => [account.code, account.id]));

  return prisma.journalEntry.create({
    data: {
      reference: args.reference,
      source: args.source,
      memo: args.memo,
      entryDate: new Date(),
      postedAt: new Date(),
      createdByStaffId: args.createdByStaffId,
      lines: {
        create: args.lines.map((line) => ({
          accountId: accountMap.get(line.accountCode)!,
          debit: line.debit || 0,
          credit: line.credit || 0,
          currency: line.currency,
          description: line.description,
        })),
      },
    },
  });
}

async function recordPaymentAnalytics(args: {
  eventKey: string;
  bookingId: string;
  packageId?: string | null;
  amount: number;
  currency: string;
}) {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);

  await prisma.analyticsEvent.upsert({
    where: {
      eventKey: args.eventKey,
    },
    update: {},
    create: {
      eventKey: args.eventKey,
      eventType: 'PAYMENT_COMPLETED',
      sessionKey: args.eventKey,
      bookingId: args.bookingId,
      packageId: args.packageId || undefined,
      metadata: {
        amount: args.amount,
        currency: args.currency,
        source: 'admin-manual-payment',
      } as Prisma.InputJsonValue,
      occurredAt: now,
    },
  });

  await prisma.dailyAnalyticsSnapshot.upsert({
    where: {
      date: dayStart,
    },
    update: {
      paymentsCompleted: { increment: 1 },
      revenueAmount: { increment: args.amount },
    },
    create: {
      date: dayStart,
      paymentsCompleted: 1,
      revenueAmount: args.amount,
      currency: args.currency,
    },
  });
}

export async function upsertCatalogPackageAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'OPS']);

  const packageId = parseText(formData.get('packageId'));
  const title = parseText(formData.get('title'));

  if (!title) {
    throw new Error('Package title is required');
  }

  const slug = parseText(formData.get('slug')) || slugify(title);
  const subtitle = parseText(formData.get('subtitle'));
  const summary = parseText(formData.get('summary'));
  const description = parseText(formData.get('description'));
  const duration = parseNumber(formData.get('duration'), 3);
  const maxGroupSize = parseNumber(formData.get('maxGroupSize'), 6);
  const priceFrom = parseNumber(formData.get('priceFrom'), 0);
  const visibility = (parseText(formData.get('visibility')) || 'PUBLISHED') as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  const featured = formData.get('featured') === 'on';
  const city = parseText(formData.get('city'));
  const country = parseText(formData.get('country')) || 'Kenya';
  const imageUrlInput = parseText(formData.get('imageUrl'));
  const altText = parseText(formData.get('imageAlt')) || title;
  const imageFile = formData.get('heroImage');

  let uploadedImage:
    | {
        secureUrl: string;
        publicId?: string;
      }
    | undefined;

  if (imageFile instanceof File && imageFile.size > 0) {
    const upload = await uploadImageToCloudinary(imageFile);
    uploadedImage = {
      secureUrl: upload.secureUrl,
      publicId: upload.publicId,
    };
  } else if (imageUrlInput) {
    uploadedImage = {
      secureUrl: imageUrlInput,
    };
  }

  const data = {
    title,
    slug,
    subtitle,
    summary: summary || subtitle || null,
    description,
    duration,
    maxGroupSize,
    difficulty: parseText(formData.get('difficulty')) || 'Easy',
    priceFrom,
    currency: (parseText(formData.get('currency')) || 'USD') as 'USD' | 'KES' | 'TZS',
    locations: [{ country, city }] as Prisma.InputJsonValue,
    itinerary: [] as Prisma.InputJsonValue,
    inclusions: parseList(formData.get('inclusions')) as Prisma.InputJsonValue,
    exclusions: parseList(formData.get('exclusions')) as Prisma.InputJsonValue,
    highlights: parseList(formData.get('highlights')) as Prisma.InputJsonValue,
    bestSeasons: parseList(formData.get('bestSeasons')) as Prisma.InputJsonValue,
    featured,
    visibility,
    archivedAt: visibility === 'ARCHIVED' ? new Date() : null,
    publishedAt: visibility === 'PUBLISHED' ? new Date() : null,
  };

  const packageRecord = packageId
    ? await prisma.catalogPackage.update({
        where: {
          id: packageId,
        },
        data,
      })
    : await prisma.catalogPackage.create({
        data,
      });

  if (uploadedImage) {
    const assetCount = await prisma.packageAsset.count({
      where: {
        packageId: packageRecord.id,
      },
    });

    await prisma.packageAsset.updateMany({
      where: {
        packageId: packageRecord.id,
      },
      data: {
        isPrimary: false,
      },
    });

    await prisma.packageAsset.create({
      data: {
        packageId: packageRecord.id,
        url: uploadedImage.secureUrl,
        alt: altText,
        cloudinaryPublicId: uploadedImage.publicId || null,
        sortOrder: assetCount,
        isPrimary: true,
      },
    });
  }

  await writeAuditLog(staff.id, packageId ? 'package.updated' : 'package.created', 'CatalogPackage', packageRecord.id, {
    title: packageRecord.title,
    visibility: packageRecord.visibility,
  } as Prisma.JsonObject);

  revalidatePath('/dashboard');
  revalidatePath('/packages');
  revalidatePath(`/packages/${packageRecord.id}`);
}

export async function togglePackageVisibilityAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'OPS']);
  const packageId = parseText(formData.get('packageId'));
  const visibility = (parseText(formData.get('visibility')) || 'ARCHIVED') as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

  if (!packageId) {
    throw new Error('Package id is required');
  }

  const packageRecord = await prisma.catalogPackage.update({
    where: {
      id: packageId,
    },
    data: {
      visibility,
      archivedAt: visibility === 'ARCHIVED' ? new Date() : null,
      publishedAt: visibility === 'PUBLISHED' ? new Date() : null,
    },
  });

  await writeAuditLog(staff.id, 'package.visibility.changed', 'CatalogPackage', packageRecord.id, {
    visibility,
  } as Prisma.JsonObject);

  revalidatePath('/dashboard');
  revalidatePath('/packages');
  revalidatePath(`/packages/${packageRecord.id}`);
}

export async function setPrimaryPackageAssetAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'OPS']);
  const packageId = parseText(formData.get('packageId'));
  const assetId = parseText(formData.get('assetId'));

  if (!packageId || !assetId) {
    throw new Error('Package id and asset id are required');
  }

  await prisma.$transaction(async (tx) => {
    await tx.packageAsset.updateMany({
      where: {
        packageId,
      },
      data: {
        isPrimary: false,
      },
    });

    await tx.packageAsset.update({
      where: {
        id: assetId,
      },
      data: {
        isPrimary: true,
      },
    });
  });

  await writeAuditLog(staff.id, 'package.asset.primary.changed', 'CatalogPackage', packageId, {
    assetId,
  } as Prisma.JsonObject);

  revalidatePath('/packages');
  revalidatePath(`/packages/${packageId}`);
}

export async function removePackageAssetAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'OPS']);
  const packageId = parseText(formData.get('packageId'));
  const assetId = parseText(formData.get('assetId'));

  if (!packageId || !assetId) {
    throw new Error('Package id and asset id are required');
  }

  const asset = await prisma.packageAsset.findUnique({
    where: {
      id: assetId,
    },
  });

  if (!asset || asset.packageId !== packageId) {
    throw new Error('Asset not found');
  }

  await prisma.packageAsset.delete({
    where: {
      id: assetId,
    },
  });

  const nextPrimary = await prisma.packageAsset.findFirst({
    where: {
      packageId,
    },
    orderBy: {
      sortOrder: 'asc',
    },
  });

  if (nextPrimary) {
    await prisma.packageAsset.update({
      where: {
        id: nextPrimary.id,
      },
      data: {
        isPrimary: true,
      },
    });
  }

  await writeAuditLog(staff.id, 'package.asset.removed', 'CatalogPackage', packageId, {
    assetId,
  } as Prisma.JsonObject);

  revalidatePath('/packages');
  revalidatePath(`/packages/${packageId}`);
}

export async function createDepartureAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'OPS']);

  const packageId = parseText(formData.get('packageId'));
  const startDate = toDate(formData.get('startDate'));
  const endDate = toDate(formData.get('endDate'));

  if (!packageId || !startDate || !endDate) {
    throw new Error('Package, start date, and end date are required');
  }

  const departure = await prisma.departure.create({
    data: {
      packageId,
      name: parseText(formData.get('name')) || null,
      code: parseText(formData.get('code')) || `DPT-${Date.now().toString(36).toUpperCase()}`,
      startDate,
      endDate,
      capacity: parseNumber(formData.get('capacity'), 6),
      status: (parseText(formData.get('status')) || 'OPEN') as 'DRAFT' | 'OPEN' | 'CLOSED' | 'COMPLETED' | 'CANCELLED',
      pricePerPerson: parseNumber(formData.get('pricePerPerson'), 0),
      currency: (parseText(formData.get('currency')) || 'USD') as 'USD' | 'KES' | 'TZS',
      depositPercentage: parseNumber(formData.get('depositPercentage'), 30),
      notes: parseText(formData.get('notes')) || null,
    },
  });

  await writeAuditLog(staff.id, 'departure.created', 'Departure', departure.id, {
    packageId,
    code: departure.code,
  } as Prisma.JsonObject);

  revalidatePath('/dashboard');
  revalidatePath('/departures');
}

export async function updateDepartureStatusAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'OPS']);
  const departureId = parseText(formData.get('departureId'));
  const status = (parseText(formData.get('status')) || 'OPEN') as 'DRAFT' | 'OPEN' | 'CLOSED' | 'COMPLETED' | 'CANCELLED';

  if (!departureId) {
    throw new Error('Departure id is required');
  }

  const departure = await prisma.departure.update({
    where: {
      id: departureId,
    },
    data: {
      status,
    },
  });

  await writeAuditLog(staff.id, 'departure.status.changed', 'Departure', departure.id, {
    status,
  } as Prisma.JsonObject);

  revalidatePath('/dashboard');
  revalidatePath('/departures');
}

export async function createStaffAccessAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN']);
  const email = normalizeEmail(parseText(formData.get('email')));

  if (!email) {
    throw new Error('Staff email is required');
  }

  if (!isAllowedStaffDomain(email)) {
    throw new Error('This email domain is not allowed by the current admin policy');
  }

  const role = (parseText(formData.get('role')) || 'OPS') as StaffRole;
  const active = formData.get('active') === 'on';
  const sendInvite = formData.get('sendInvite') === 'on';
  const record = await prisma.staffUser.upsert({
    where: { email },
    update: {
      fullName: parseText(formData.get('fullName')) || null,
      role,
      active,
    },
    create: {
      email,
      fullName: parseText(formData.get('fullName')) || null,
      role,
      active,
    },
  });

  let invitationResult:
    | {
        status: 'existing-user';
      }
    | {
        status: 'invited';
        invitationId: string;
      }
    | null = null;

  if (active && sendInvite) {
    invitationResult = await inviteStaffUser(email, role);
  }

  await writeAuditLog(staff.id, 'staff.access.upserted', 'StaffUser', record.id, {
    email: record.email,
    role: record.role,
    active: record.active,
    invitation: invitationResult,
  } as Prisma.JsonObject);

  revalidatePath('/staff');
}

export async function createVendorAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'FINANCE']);
  const name = parseText(formData.get('name'));

  if (!name) {
    throw new Error('Vendor name is required');
  }

  const vendor = await prisma.vendor.create({
    data: {
      name,
      email: parseText(formData.get('email')) || null,
      phone: parseText(formData.get('phone')) || null,
      notes: parseText(formData.get('notes')) || null,
      status: 'ACTIVE',
    },
  });

  await writeAuditLog(staff.id, 'vendor.created', 'Vendor', vendor.id, {
    name: vendor.name,
  } as Prisma.JsonObject);

  revalidatePath('/finance');
}

export async function createExpenseAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'FINANCE']);
  const amount = parseNumber(formData.get('amount'), 0);
  const status = (parseText(formData.get('status')) || 'POSTED') as 'DRAFT' | 'POSTED' | 'VOID';

  if (amount <= 0) {
    throw new Error('Expense amount must be greater than zero');
  }

  const expense = await prisma.expense.create({
    data: {
      vendorId: parseText(formData.get('vendorId')) || null,
      category: parseText(formData.get('category')) || 'Operations',
      description: parseText(formData.get('description')) || 'Expense',
      amount,
      currency: (parseText(formData.get('currency')) || 'KES') as 'USD' | 'KES' | 'TZS',
      status,
      incurredAt: toDate(formData.get('incurredAt')) || new Date(),
      paidAt: status === 'POSTED' ? new Date() : null,
      notes: parseText(formData.get('notes')) || null,
      createdByStaffId: staff.id,
    },
  });

  const allocation = {
    bookingId: parseText(formData.get('bookingId')) || null,
    departureId: parseText(formData.get('departureId')) || null,
    catalogPackageId: parseText(formData.get('catalogPackageId')) || null,
  };

  if (allocation.bookingId || allocation.departureId || allocation.catalogPackageId) {
    await prisma.expenseAllocation.create({
      data: {
        expenseId: expense.id,
        bookingId: allocation.bookingId,
        departureId: allocation.departureId,
        catalogPackageId: allocation.catalogPackageId,
        amount,
      },
    });
  }

  if (status === 'POSTED') {
    await createJournalEntry({
      createdByStaffId: staff.id,
      reference: `EXP-${expense.id.slice(0, 8).toUpperCase()}`,
      source: 'expense',
      memo: expense.description,
      lines: [
        {
          accountCode: '6100',
          debit: amount,
          currency: expense.currency,
          description: expense.description,
        },
        {
          accountCode: '1000',
          credit: amount,
          currency: expense.currency,
          description: expense.description,
        },
      ],
    });
  }

  await writeAuditLog(staff.id, 'expense.created', 'Expense', expense.id, {
    amount: expense.amount,
    status: expense.status,
  } as Prisma.JsonObject);

  revalidatePath('/dashboard');
  revalidatePath('/finance');
}

export async function recordManualPaymentAction(formData: FormData) {
  const { staff } = await requireStaff(['ADMIN', 'FINANCE']);
  const bookingId = parseText(formData.get('bookingId'));
  const amount = parseNumber(formData.get('amount'), 0);

  if (!bookingId || amount <= 0) {
    throw new Error('Booking and positive amount are required');
  }

  const booking = await prisma.booking.findUnique({
    where: {
      id: bookingId,
    },
  });

  if (!booking) {
    throw new Error('Booking not found');
  }

  const invoiceId = parseText(formData.get('invoiceId')) || null;
  const invoice = invoiceId
    ? await prisma.invoice.findUnique({
        where: {
          id: invoiceId,
        },
      })
    : null;

  const payment = await prisma.manualPayment.create({
    data: {
      bookingId,
      invoiceId,
      departureId: parseText(formData.get('departureId')) || booking.departureId || null,
      channel: (parseText(formData.get('channel')) || 'BANK_TRANSFER') as PaymentChannel,
      amount,
      currency: (parseText(formData.get('currency')) || 'KES') as 'USD' | 'KES' | 'TZS',
      reference: parseText(formData.get('reference')) || null,
      notes: parseText(formData.get('notes')) || null,
      receivedAt: toDate(formData.get('receivedAt')) || new Date(),
      receivedByStaffId: staff.id,
    },
  });

  if (invoice) {
    const nextPaidAmount = Math.min(invoice.paidAmount + amount, invoice.totalAmount);
    const invoiceStatus = nextPaidAmount >= invoice.totalAmount ? 'paid' : 'pending';

    await prisma.invoice.update({
      where: {
        id: invoice.id,
      },
      data: {
        paidAmount: nextPaidAmount,
        dueAmount: Math.max(invoice.totalAmount - nextPaidAmount, 0),
        status: invoiceStatus,
        paidAt: invoiceStatus === 'paid' ? new Date() : invoice.paidAt,
      },
    });

    await prisma.booking.update({
      where: {
        id: bookingId,
      },
      data: {
        paymentStatus:
          invoice.type === 'BALANCE' && invoiceStatus === 'paid'
            ? 'paid_in_full'
            : invoice.type === 'DEPOSIT' && invoiceStatus === 'paid'
              ? 'deposit_paid'
              : booking.paymentStatus,
        status:
          invoice.type === 'BALANCE' && invoiceStatus === 'paid'
            ? 'paid_in_full'
            : invoice.type === 'DEPOSIT' && invoiceStatus === 'paid'
              ? 'confirmed'
              : booking.status,
      },
    });

    await prisma.departureReservation.updateMany({
      where: {
        bookingId,
      },
      data: {
        status: invoiceStatus === 'paid' ? 'CONFIRMED' : 'HOLD',
      },
    });
  }

  await createJournalEntry({
    createdByStaffId: staff.id,
    reference: `PAY-${payment.id.slice(0, 8).toUpperCase()}`,
    source: 'manual_payment',
    memo: payment.notes || `Manual payment for booking ${booking.bookingReference}`,
    lines: [
      {
        accountCode: payment.channel === 'BANK_TRANSFER' ? '1100' : '1000',
        debit: amount,
        currency: payment.currency,
        description: payment.reference || booking.bookingReference,
      },
      {
        accountCode: '4000',
        credit: amount,
        currency: payment.currency,
        description: payment.reference || booking.bookingReference,
      },
    ],
  });

  await recordPaymentAnalytics({
    eventKey: `PAYMENT_COMPLETED:manual:${payment.id}`,
    bookingId,
    packageId: booking.catalogPackageId,
    amount,
    currency: payment.currency,
  });

  await writeAuditLog(staff.id, 'manual-payment.recorded', 'ManualPayment', payment.id, {
    bookingId,
    amount,
    currency: payment.currency,
  } as Prisma.JsonObject);

  revalidatePath('/dashboard');
  revalidatePath('/finance');
  revalidatePath('/bookings');
}
