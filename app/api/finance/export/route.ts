import { NextResponse } from 'next/server';
import { getOptionalStaffUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type ExportType = 'payments' | 'expenses' | 'journal' | 'reconciliation';

function escapeCsv(value: unknown) {
  const text =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);

  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function createCsv(headers: string[], rows: Array<Record<string, unknown>>) {
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(',')),
  ];

  return lines.join('\n');
}

function csvResponse(filename: string, csv: string) {
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(request: Request) {
  const staff = await getOptionalStaffUser();

  if (!staff || (staff.role !== 'ADMIN' && staff.role !== 'FINANCE')) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Finance export access denied',
        },
      },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const type = (searchParams.get('type') || 'payments') as ExportType;
  const stamp = new Date().toISOString().slice(0, 10);

  if (type === 'payments') {
    const [manualPayments, paymentAttempts] = await Promise.all([
      prisma.manualPayment.findMany({
        include: {
          booking: true,
          invoice: true,
        },
        orderBy: {
          receivedAt: 'desc',
        },
      }),
      prisma.paymentAttempt.findMany({
        where: {
          status: 'completed',
        },
        include: {
          booking: true,
          invoice: true,
        },
        orderBy: {
          completedAt: 'desc',
        },
      }),
    ]);

    const rows = [
      ...manualPayments.map((payment) => ({
        source: 'manual',
        receivedAt: payment.receivedAt,
        bookingReference: payment.booking.bookingReference,
        invoiceNumber: payment.invoice?.invoiceNumber || '',
        channel: payment.channel,
        status: payment.invoice?.status || payment.booking.paymentStatus,
        amount: payment.amount,
        currency: payment.currency,
        referenceCode: payment.reference || '',
        notes: payment.notes || '',
      })),
      ...paymentAttempts.map((attempt) => ({
        source: 'pesapal',
        receivedAt: attempt.completedAt || attempt.updatedAt,
        bookingReference: attempt.booking.bookingReference,
        invoiceNumber: attempt.invoice.invoiceNumber,
        channel: attempt.paymentMethod || attempt.provider,
        status: attempt.status,
        amount: attempt.amount,
        currency: attempt.currency,
        referenceCode: attempt.trackingId || attempt.merchantReference,
        notes: attempt.providerStatusDescription || '',
      })),
    ].sort((left, right) => String(right.receivedAt).localeCompare(String(left.receivedAt)));

    return csvResponse(
      `mystical-finance-payments-${stamp}.csv`,
      createCsv(
        ['source', 'receivedAt', 'bookingReference', 'invoiceNumber', 'channel', 'status', 'amount', 'currency', 'referenceCode', 'notes'],
        rows
      )
    );
  }

  if (type === 'expenses') {
    const expenses = await prisma.expense.findMany({
      include: {
        vendor: true,
        allocations: true,
      },
      orderBy: {
        incurredAt: 'desc',
      },
    });

    const rows = expenses.map((expense) => ({
      incurredAt: expense.incurredAt,
      paidAt: expense.paidAt || '',
      vendor: expense.vendor?.name || '',
      category: expense.category,
      description: expense.description,
      status: expense.status,
      amount: expense.amount,
      currency: expense.currency,
      allocationCount: expense.allocations.length,
      allocationAmount: expense.allocations.reduce((sum, allocation) => sum + allocation.amount, 0),
      notes: expense.notes || '',
    }));

    return csvResponse(
      `mystical-finance-expenses-${stamp}.csv`,
      createCsv(
        ['incurredAt', 'paidAt', 'vendor', 'category', 'description', 'status', 'amount', 'currency', 'allocationCount', 'allocationAmount', 'notes'],
        rows
      )
    );
  }

  if (type === 'journal') {
    const entries = await prisma.journalEntry.findMany({
      include: {
        lines: {
          include: {
            account: true,
          },
        },
      },
      orderBy: {
        entryDate: 'desc',
      },
    });

    const rows = entries.flatMap((entry) =>
      entry.lines.map((line) => ({
        entryDate: entry.entryDate,
        reference: entry.reference || '',
        source: entry.source,
        memo: entry.memo || '',
        accountCode: line.account.code,
        accountName: line.account.name,
        debit: line.debit,
        credit: line.credit,
        currency: line.currency,
        lineDescription: line.description || '',
      }))
    );

    return csvResponse(
      `mystical-finance-journal-${stamp}.csv`,
      createCsv(
        ['entryDate', 'reference', 'source', 'memo', 'accountCode', 'accountName', 'debit', 'credit', 'currency', 'lineDescription'],
        rows
      )
    );
  }

  const [outstandingInvoices, unappliedManualPayments, draftExpenses] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        dueAmount: {
          gt: 0,
        },
        status: {
          in: ['issued', 'pending', 'overdue'],
        },
      },
      include: {
        booking: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    }),
    prisma.manualPayment.findMany({
      where: {
        invoiceId: null,
      },
      include: {
        booking: true,
      },
      orderBy: {
        receivedAt: 'desc',
      },
    }),
    prisma.expense.findMany({
      where: {
        status: 'DRAFT',
      },
      include: {
        vendor: true,
      },
      orderBy: {
        incurredAt: 'desc',
      },
    }),
  ]);

  const rows = [
    ...outstandingInvoices.map((invoice) => ({
      category: 'outstanding_invoice',
      reference: invoice.invoiceNumber,
      bookingReference: invoice.booking.bookingReference,
      date: invoice.createdAt,
      status: invoice.status,
      amount: invoice.dueAmount,
      currency: invoice.currency,
      note: invoice.type,
    })),
    ...unappliedManualPayments.map((payment) => ({
      category: 'unapplied_manual_payment',
      reference: payment.reference || payment.id,
      bookingReference: payment.booking.bookingReference,
      date: payment.receivedAt,
      status: payment.channel,
      amount: payment.amount,
      currency: payment.currency,
      note: payment.notes || '',
    })),
    ...draftExpenses.map((expense) => ({
      category: 'draft_expense',
      reference: expense.id,
      bookingReference: '',
      date: expense.incurredAt,
      status: expense.status,
      amount: expense.amount,
      currency: expense.currency,
      note: `${expense.vendor?.name || 'No vendor'} - ${expense.description}`,
    })),
  ];

  return csvResponse(
    `mystical-finance-reconciliation-${stamp}.csv`,
    createCsv(['category', 'reference', 'bookingReference', 'date', 'status', 'amount', 'currency', 'note'], rows)
  );
}
