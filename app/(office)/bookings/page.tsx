import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { requireStaff } from '@/lib/auth';
import { getBookingJourneyLabel } from '@/lib/bookings';
import { prisma } from '@/lib/prisma';

function formatCurrency(amount: number, currency = 'KES') {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: Date | null | undefined) {
  if (!value) {
    return 'N/A';
  }

  return value.toLocaleDateString('en-KE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function humanize(value: string | null | undefined) {
  if (!value) {
    return 'Unknown';
  }

  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

const bookingInclude = {
  catalogPackage: true,
  departure: true,
  invoices: {
    orderBy: {
      createdAt: 'desc' as const,
    },
  },
  manualPayments: {
    orderBy: {
      receivedAt: 'desc' as const,
    },
  },
} satisfies Prisma.BookingInclude;

type BookingRecord = Prisma.BookingGetPayload<{
  include: typeof bookingInclude;
}>;

type BookingView = 'paid' | 'needs-action' | 'all';
type SearchParams = Promise<{
  view?: string;
}>;

const paidWhere: Prisma.BookingWhereInput = {
  paymentStatus: {
    in: ['deposit_paid', 'paid_in_full'],
  },
};

const needsActionWhere: Prisma.BookingWhereInput = {
  OR: [
    {
      paymentStatus: {
        in: ['pending', 'deposit_due', 'balance_due', 'full_due', 'partial', 'pending_review', 'failed'],
      },
    },
    {
      status: {
        in: ['deposit_pending', 'balance_pending', 'payment_pending'],
      },
    },
  ],
};

function resolveView(rawView?: string): BookingView {
  if (rawView === 'needs-action' || rawView === 'all') {
    return rawView;
  }

  return 'paid';
}

function getWhereForView(view: BookingView): Prisma.BookingWhereInput | undefined {
  if (view === 'paid') {
    return paidWhere;
  }

  if (view === 'needs-action') {
    return needsActionWhere;
  }

  return undefined;
}

function getBookingCurrency(booking: BookingRecord) {
  if (booking.invoices[0]?.currency) {
    return booking.invoices[0].currency;
  }

  if (booking.manualPayments[0]?.currency) {
    return booking.manualPayments[0].currency;
  }

  const priceBreakdown = booking.priceBreakdown;
  if (
    priceBreakdown &&
    typeof priceBreakdown === 'object' &&
    'currency' in priceBreakdown &&
    typeof priceBreakdown.currency === 'string'
  ) {
    return priceBreakdown.currency;
  }

  return 'KES';
}

function getReceivedAmount(booking: BookingRecord) {
  const invoicePaidAmount = booking.invoices.reduce((sum, invoice) => sum + invoice.paidAmount, 0);
  const unappliedManualAmount = booking.manualPayments
    .filter((payment) => !payment.invoiceId)
    .reduce((sum, payment) => sum + payment.amount, 0);

  return invoicePaidAmount + unappliedManualAmount;
}

function getPaymentSummary(booking: BookingRecord) {
  switch (booking.paymentStatus) {
    case 'deposit_paid':
      return {
        label: 'Deposit paid',
        tone: 'bg-emerald-100 text-emerald-800',
      };
    case 'paid_in_full':
      return {
        label: 'Paid in full',
        tone: 'bg-emerald-100 text-emerald-800',
      };
    case 'partial':
      return {
        label: 'Partially paid',
        tone: 'bg-amber-100 text-amber-800',
      };
    case 'failed':
      return {
        label: 'Payment failed',
        tone: 'bg-rose-100 text-rose-800',
      };
    case 'pending_review':
      return {
        label: 'Pending review',
        tone: 'bg-amber-100 text-amber-800',
      };
    case 'deposit_due':
      return {
        label: 'Deposit due',
        tone: 'bg-slate-100 text-slate-700',
      };
    case 'balance_due':
      return {
        label: 'Balance due',
        tone: 'bg-slate-100 text-slate-700',
      };
    case 'full_due':
      return {
        label: 'Full payment due',
        tone: 'bg-slate-100 text-slate-700',
      };
    default:
      return {
        label: humanize(booking.paymentStatus),
        tone: 'bg-slate-100 text-slate-700',
      };
  }
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { staff } = await requireStaff(['ADMIN', 'OPS']);
  const params = await searchParams;
  const activeView = resolveView(params.view);

  const [bookings, paidCount, needsActionCount, allCount] = await Promise.all([
    prisma.booking.findMany({
      where: getWhereForView(activeView),
      include: bookingInclude,
      orderBy: {
        updatedAt: 'desc',
      },
      take: 30,
    }),
    prisma.booking.count({ where: paidWhere }),
    prisma.booking.count({ where: needsActionWhere }),
    prisma.booking.count(),
  ]);

  const tabs: Array<{ key: BookingView; label: string; count: number }> = [
    { key: 'paid', label: 'Paid', count: paidCount },
    { key: 'needs-action', label: 'Needs Action', count: needsActionCount },
    { key: 'all', label: 'All', count: allCount },
  ];

  return (
    <div className="space-y-6">
      <section className="panel-strong p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="eyebrow mb-3">Booking Operations</p>
            <h1 className="heading mb-4">Keep the booking list focused on money received, what still needs action, and the detail behind each record only when you need it.</h1>
            <p className="max-w-3xl text-muted">
              Paid bookings are the default view. Invoices, manual receipts, and departure detail now stay tucked into each booking instead of competing for space in the main list.
            </p>
          </div>
          {staff.role === 'ADMIN' && (
            <Link href="/bookings/new" className="button-primary">
              New manual booking
            </Link>
          )}
        </div>
      </section>

      <section className="panel p-6">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="eyebrow mb-2">View</p>
            <h2 className="font-display text-3xl">Bookings</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => {
              const href = tab.key === 'paid' ? '/bookings' : `/bookings?view=${encodeURIComponent(tab.key)}`;
              const isActive = tab.key === activeView;

              return (
                <Link
                  key={tab.key}
                  href={href}
                  className={isActive ? 'button-primary' : 'button-secondary'}
                >
                  {tab.label} ({tab.count})
                </Link>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          {bookings.map((booking) => {
            const journey = getBookingJourneyLabel({
              catalogPackageTitle: booking.catalogPackage?.title,
              items: booking.items,
              guestDetails: booking.guestDetails,
            });
            const payment = getPaymentSummary(booking);
            const currency = getBookingCurrency(booking);
            const amountReceived = getReceivedAmount(booking);

            return (
              <details
                key={booking.id}
                className="rounded-[24px] border border-line bg-white/75 open:bg-white"
              >
                <summary
                  className="cursor-pointer list-none p-5"
                  style={{ listStyle: 'none' }}
                >
                  <div className="grid gap-4 lg:grid-cols-[1.1fr_1.35fr_1fr_1fr_auto] lg:items-start">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Reference</p>
                      <p className="mt-2 font-medium text-foreground">{booking.bookingReference}</p>
                      <p className="mt-1 text-xs text-muted">{booking.channel}</p>
                    </div>

                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Journey</p>
                      <p className="mt-2 font-medium text-foreground">{journey}</p>
                      <p className="mt-1 text-xs text-muted">Created {formatDate(booking.createdAt)}</p>
                    </div>

                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Payment</p>
                      <div className="mt-2 space-y-2">
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${payment.tone}`}>
                          {payment.label}
                        </span>
                        <p className="text-xs text-muted">{humanize(booking.status)}</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Amount Received</p>
                      <p className="mt-2 font-medium text-foreground">{formatCurrency(amountReceived, currency)}</p>
                      <p className="mt-1 text-xs text-muted">
                        {booking.invoices.length > 0 ? `${booking.invoices.length} invoice${booking.invoices.length === 1 ? '' : 's'}` : 'No invoices'}
                      </p>
                    </div>

                    <div className="lg:text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Details</p>
                      <p className="mt-2 text-sm text-foreground">View</p>
                    </div>
                  </div>
                </summary>

                <div className="border-t border-line px-5 pb-5 pt-4">
                  <div className="grid gap-4 xl:grid-cols-[0.85fr_1.2fr_1fr]">
                    <div className="rounded-[20px] border border-line bg-panel p-4">
                      <p className="eyebrow mb-3">Booking</p>
                      <div className="space-y-2 text-sm text-muted">
                        <p><span className="font-medium text-foreground">Status:</span> {humanize(booking.status)}</p>
                        <p><span className="font-medium text-foreground">Payment:</span> {humanize(booking.paymentStatus)}</p>
                        {booking.departure ? (
                          <p><span className="font-medium text-foreground">Departure:</span> {booking.departure.code}</p>
                        ) : null}
                        <p><span className="font-medium text-foreground">Updated:</span> {formatDate(booking.updatedAt)}</p>
                      </div>
                    </div>

                    <div className="rounded-[20px] border border-line bg-panel p-4">
                      <p className="eyebrow mb-3">Invoices</p>
                      <div className="space-y-3">
                        {booking.invoices.length > 0 ? (
                          booking.invoices.map((invoice) => (
                            <div key={invoice.id} className="rounded-[18px] border border-line/80 bg-white/80 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-medium text-foreground">{invoice.invoiceNumber}</p>
                                  <p className="text-xs text-muted">{humanize(invoice.type)} · {humanize(invoice.status)}</p>
                                </div>
                                <p className="text-sm font-medium text-foreground">{formatCurrency(invoice.totalAmount, invoice.currency)}</p>
                              </div>
                              <p className="mt-2 text-xs text-muted">
                                Paid {formatCurrency(invoice.paidAmount, invoice.currency)} · Remaining {formatCurrency(invoice.dueAmount, invoice.currency)}
                              </p>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted">No invoices yet.</p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-[20px] border border-line bg-panel p-4">
                      <p className="eyebrow mb-3">Manual Receipts</p>
                      <div className="space-y-3">
                        {booking.manualPayments.length > 0 ? (
                          booking.manualPayments.map((payment) => (
                            <div key={payment.id} className="rounded-[18px] border border-line/80 bg-white/80 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-medium text-foreground">{humanize(payment.channel)}</p>
                                  <p className="text-xs text-muted">{payment.reference || 'No reference recorded'}</p>
                                </div>
                                <p className="text-sm font-medium text-foreground">{formatCurrency(payment.amount, payment.currency)}</p>
                              </div>
                              <p className="mt-2 text-xs text-muted">Received {formatDate(payment.receivedAt)}</p>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted">No manual receipts recorded.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </details>
            );
          })}

          {bookings.length === 0 && (
            <div className="rounded-[24px] border border-line bg-white/75 p-8 text-center">
              <p className="font-medium text-foreground">
                {activeView === 'paid'
                  ? 'No paid bookings yet.'
                  : activeView === 'needs-action'
                    ? 'No bookings currently need action.'
                    : 'No bookings yet.'}
              </p>
              <p className="mt-2 text-sm text-muted">
                Switch views above if you want to inspect a different slice of the booking list.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
