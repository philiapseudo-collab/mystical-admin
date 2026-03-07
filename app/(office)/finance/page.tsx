import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createExpenseAction, createVendorAction, recordManualPaymentAction } from '@/app/(office)/actions';

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

export default async function FinancePage() {
  await requireStaff(['ADMIN', 'FINANCE']);

  const [
    vendors,
    packages,
    departures,
    bookings,
    invoices,
    expenses,
    manualPayments,
    journalEntries,
    outstandingInvoices,
    unappliedManualPayments,
    draftExpenses,
    completedPaymentTotals,
    postedExpenseTotals,
    outstandingTotals,
  ] = await Promise.all([
    prisma.vendor.findMany({ orderBy: { name: 'asc' } }),
    prisma.catalogPackage.findMany({
      where: { visibility: { not: 'ARCHIVED' } },
      orderBy: { title: 'asc' },
    }),
    prisma.departure.findMany({
      include: {
        package: true,
      },
      orderBy: { startDate: 'asc' },
      take: 50,
    }),
    prisma.booking.findMany({
      include: { catalogPackage: true, departure: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.invoice.findMany({
      where: { status: { in: ['issued', 'pending', 'overdue'] } },
      include: { booking: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.expense.findMany({
      include: { vendor: true, allocations: true },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
    prisma.manualPayment.findMany({
      include: { booking: true, invoice: true },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
    prisma.journalEntry.findMany({
      include: {
        lines: {
          include: {
            account: true,
          },
        },
      },
      orderBy: { entryDate: 'desc' },
      take: 15,
    }),
    prisma.invoice.findMany({
      where: {
        dueAmount: { gt: 0 },
        status: { in: ['issued', 'pending', 'overdue'] },
      },
      include: { booking: true },
      orderBy: { dueDate: 'asc' },
      take: 12,
    }),
    prisma.manualPayment.findMany({
      where: { invoiceId: null },
      include: { booking: true },
      orderBy: { receivedAt: 'desc' },
      take: 12,
    }),
    prisma.expense.findMany({
      where: { status: 'DRAFT' },
      include: { vendor: true },
      orderBy: { incurredAt: 'desc' },
      take: 12,
    }),
    prisma.$transaction([
      prisma.manualPayment.aggregate({
        _sum: {
          amount: true,
        },
      }),
      prisma.paymentAttempt.aggregate({
        where: {
          status: 'completed',
        },
        _sum: {
          amount: true,
        },
      }),
    ]),
    prisma.expense.aggregate({
      where: {
        status: 'POSTED',
      },
      _sum: {
        amount: true,
      },
    }),
    prisma.invoice.aggregate({
      where: {
        dueAmount: { gt: 0 },
        status: { in: ['issued', 'pending', 'overdue'] },
      },
      _sum: {
        dueAmount: true,
      },
    }),
  ]);

  const cashIn =
    (completedPaymentTotals[0]._sum.amount || 0) +
    (completedPaymentTotals[1]._sum.amount || 0);
  const cashOut = postedExpenseTotals._sum.amount || 0;
  const outstandingReceivables = outstandingTotals._sum.dueAmount || 0;
  const netCash = cashIn - cashOut;

  return (
    <div className="space-y-6">
      <section className="panel-strong p-8">
        <p className="eyebrow mb-3">Finance Console</p>
        <h1 className="heading mb-4">Reconcile money in, money out, and the accounting trail behind every booking.</h1>
        <p className="max-w-3xl text-muted">
          This slice adds export-ready CSV downloads and a reconciliation board for receivables, unapplied payments, and draft costs.
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        <article className="panel p-5">
          <p className="eyebrow mb-2">Cash in</p>
          <p className="font-display text-4xl">{formatCurrency(cashIn)}</p>
          <p className="mt-2 text-sm text-muted">Manual payments and completed Pesapal collections.</p>
        </article>
        <article className="panel p-5">
          <p className="eyebrow mb-2">Cash out</p>
          <p className="font-display text-4xl">{formatCurrency(cashOut)}</p>
          <p className="mt-2 text-sm text-muted">Posted expenses only. Draft spend stays off the cash position.</p>
        </article>
        <article className="panel p-5">
          <p className="eyebrow mb-2">Net cash</p>
          <p className="font-display text-4xl">{formatCurrency(netCash)}</p>
          <p className="mt-2 text-sm text-muted">Operational inflow minus posted outflow.</p>
        </article>
        <article className="panel p-5">
          <p className="eyebrow mb-2">Receivables</p>
          <p className="font-display text-4xl">{formatCurrency(outstandingReceivables)}</p>
          <p className="mt-2 text-sm text-muted">Invoices still open or partially settled.</p>
        </article>
      </section>

      <section className="panel p-6">
        <div className="mb-4">
          <p className="eyebrow mb-2">Exports</p>
          <h2 className="font-display text-3xl">Download finance extracts</h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <a href="/api/finance/export?type=payments" className="button-secondary">Payments CSV</a>
          <a href="/api/finance/export?type=expenses" className="button-secondary">Expenses CSV</a>
          <a href="/api/finance/export?type=journal" className="button-secondary">Journal CSV</a>
          <a href="/api/finance/export?type=reconciliation" className="button-secondary">Reconciliation CSV</a>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <article className="panel p-6">
          <div className="mb-4">
            <p className="eyebrow mb-2">Vendor</p>
            <h2 className="font-display text-2xl">Add supplier</h2>
          </div>
          <form action={createVendorAction} className="space-y-3">
            <input name="name" className="input" placeholder="Vendor name" required />
            <input name="email" className="input" placeholder="Email" />
            <input name="phone" className="input" placeholder="Phone" />
            <textarea name="notes" className="textarea" placeholder="Notes" />
            <button type="submit" className="button-primary w-full">Save vendor</button>
          </form>
        </article>

        <article className="panel p-6">
          <div className="mb-4">
            <p className="eyebrow mb-2">Expense</p>
            <h2 className="font-display text-2xl">Post outgoing money</h2>
          </div>
          <form action={createExpenseAction} className="space-y-3">
            <select name="vendorId" className="select" defaultValue="">
              <option value="">No vendor</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
              ))}
            </select>
            <input name="category" className="input" placeholder="Category" defaultValue="Operations" />
            <input name="description" className="input" placeholder="Description" required />
            <input name="amount" type="number" min="0" step="0.01" className="input" placeholder="Amount" required />
            <select name="currency" className="select" defaultValue="KES">
              <option value="KES">KES</option>
              <option value="USD">USD</option>
              <option value="TZS">TZS</option>
            </select>
            <input name="incurredAt" type="date" className="input" />
            <select name="status" className="select" defaultValue="POSTED">
              <option value="POSTED">Posted</option>
              <option value="DRAFT">Draft</option>
            </select>
            <select name="bookingId" className="select" defaultValue="">
              <option value="">No booking allocation</option>
              {bookings.map((booking) => (
                <option key={booking.id} value={booking.id}>{booking.bookingReference}</option>
              ))}
            </select>
            <select name="departureId" className="select" defaultValue="">
              <option value="">No departure allocation</option>
              {departures.map((departure) => (
                <option key={departure.id} value={departure.id}>
                  {departure.code} · {departure.package.title}
                </option>
              ))}
            </select>
            <select name="catalogPackageId" className="select" defaultValue="">
              <option value="">No package allocation</option>
              {packages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>{pkg.title}</option>
              ))}
            </select>
            <textarea name="notes" className="textarea" placeholder="Notes" />
            <button type="submit" className="button-primary w-full">Save expense</button>
          </form>
        </article>

        <article className="panel p-6">
          <div className="mb-4">
            <p className="eyebrow mb-2">Manual payment</p>
            <h2 className="font-display text-2xl">Record incoming money</h2>
          </div>
          <form action={recordManualPaymentAction} className="space-y-3">
            <select name="bookingId" className="select" required defaultValue="">
              <option value="" disabled>Select booking</option>
              {bookings.map((booking) => (
                <option key={booking.id} value={booking.id}>
                  {booking.bookingReference} {booking.catalogPackage ? `· ${booking.catalogPackage.title}` : ''}
                </option>
              ))}
            </select>
            <select name="invoiceId" className="select" defaultValue="">
              <option value="">No linked invoice</option>
              {invoices.map((invoice) => (
                <option key={invoice.id} value={invoice.id}>
                  {invoice.invoiceNumber} · {invoice.booking.bookingReference}
                </option>
              ))}
            </select>
            <select name="departureId" className="select" defaultValue="">
              <option value="">Use booking departure</option>
              {departures.map((departure) => (
                <option key={departure.id} value={departure.id}>
                  {departure.code} · {departure.package.title}
                </option>
              ))}
            </select>
            <select name="channel" className="select" defaultValue="BANK_TRANSFER">
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="MPESA_MANUAL">Direct M-Pesa</option>
              <option value="CASH">Cash</option>
              <option value="OFFICE_CARD">Office card</option>
              <option value="OTHER">Other</option>
            </select>
            <input name="amount" type="number" min="0" step="0.01" className="input" placeholder="Amount" required />
            <select name="currency" className="select" defaultValue="KES">
              <option value="KES">KES</option>
              <option value="USD">USD</option>
              <option value="TZS">TZS</option>
            </select>
            <input name="reference" className="input" placeholder="Reference / confirmation code" />
            <input name="receivedAt" type="date" className="input" />
            <textarea name="notes" className="textarea" placeholder="Notes" />
            <button type="submit" className="button-primary w-full">Record payment</button>
          </form>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <article className="panel p-6">
          <div className="mb-5">
            <p className="eyebrow mb-2">Open invoices</p>
            <h2 className="font-display text-3xl">Receivables to chase</h2>
          </div>
          <div className="space-y-3">
            {outstandingInvoices.map((invoice) => (
              <div key={invoice.id} className="rounded-[22px] border border-line bg-white/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">{invoice.invoiceNumber}</p>
                    <p className="text-sm text-muted">{invoice.booking.bookingReference}</p>
                  </div>
                  <span className="pill">{invoice.status}</span>
                </div>
                <p className="mt-3 text-sm text-muted">
                  Due {formatDate(invoice.dueDate)} · {formatCurrency(invoice.dueAmount, invoice.currency)}
                </p>
              </div>
            ))}
            {outstandingInvoices.length === 0 && (
              <div className="rounded-[24px] border border-dashed border-line bg-white/50 p-6 text-sm text-muted">
                No outstanding invoices right now.
              </div>
            )}
          </div>
        </article>

        <article className="panel p-6">
          <div className="mb-5">
            <p className="eyebrow mb-2">Unapplied cash</p>
            <h2 className="font-display text-3xl">Payments needing matching</h2>
          </div>
          <div className="space-y-3">
            {unappliedManualPayments.map((payment) => (
              <div key={payment.id} className="rounded-[22px] border border-line bg-white/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">{payment.booking.bookingReference}</p>
                    <p className="text-sm text-muted">{payment.reference || payment.channel}</p>
                  </div>
                  <span className="pill">{payment.channel}</span>
                </div>
                <p className="mt-3 text-sm text-muted">
                  {formatCurrency(payment.amount, payment.currency)} · received {formatDate(payment.receivedAt)}
                </p>
              </div>
            ))}
            {unappliedManualPayments.length === 0 && (
              <div className="rounded-[24px] border border-dashed border-line bg-white/50 p-6 text-sm text-muted">
                Every recent manual payment is linked to an invoice.
              </div>
            )}
          </div>
        </article>

        <article className="panel p-6">
          <div className="mb-5">
            <p className="eyebrow mb-2">Draft spend</p>
            <h2 className="font-display text-3xl">Costs still pending posting</h2>
          </div>
          <div className="space-y-3">
            {draftExpenses.map((expense) => (
              <div key={expense.id} className="rounded-[22px] border border-line bg-white/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">{expense.description}</p>
                    <p className="text-sm text-muted">{expense.vendor?.name || 'No vendor'}</p>
                  </div>
                  <span className="pill">{expense.status}</span>
                </div>
                <p className="mt-3 text-sm text-muted">
                  {formatCurrency(expense.amount, expense.currency)} · incurred {formatDate(expense.incurredAt)}
                </p>
              </div>
            ))}
            {draftExpenses.length === 0 && (
              <div className="rounded-[24px] border border-dashed border-line bg-white/50 p-6 text-sm text-muted">
                No draft expenses waiting for posting.
              </div>
            )}
          </div>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <article className="panel p-6">
          <div className="mb-5">
            <p className="eyebrow mb-2">Latest expenses</p>
            <h2 className="font-display text-3xl">Outgoing cash</h2>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Vendor</th>
                  <th>Status</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>
                      <div className="font-medium">{expense.description}</div>
                      <div className="text-xs text-muted">{expense.allocations.length} allocations</div>
                    </td>
                    <td>{expense.vendor?.name || 'No vendor'}</td>
                    <td><span className="pill">{expense.status}</span></td>
                    <td>{formatCurrency(expense.amount, expense.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel p-6">
          <div className="mb-5">
            <p className="eyebrow mb-2">Latest manual payments</p>
            <h2 className="font-display text-3xl">Incoming cash</h2>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Channel</th>
                  <th>Reference</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {manualPayments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{payment.booking.bookingReference}</td>
                    <td>{payment.channel}</td>
                    <td>{payment.reference || 'N/A'}</td>
                    <td>{formatCurrency(payment.amount, payment.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel p-6">
          <div className="mb-5">
            <p className="eyebrow mb-2">Recent journals</p>
            <h2 className="font-display text-3xl">Accounting trail</h2>
          </div>
          <div className="space-y-3">
            {journalEntries.map((entry) => (
              <div key={entry.id} className="rounded-[22px] border border-line bg-white/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">{entry.reference || entry.source}</p>
                    <p className="text-sm text-muted">{entry.memo || 'No memo'}</p>
                  </div>
                  <span className="pill">{entry.source}</span>
                </div>
                <div className="mt-3 space-y-1 text-sm text-muted">
                  {entry.lines.slice(0, 3).map((line) => (
                    <div key={line.id} className="flex items-center justify-between gap-3">
                      <span>{line.account.code} · {line.account.name}</span>
                      <span>
                        {line.debit > 0 ? `Dr ${formatCurrency(line.debit, line.currency)}` : `Cr ${formatCurrency(line.credit, line.currency)}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {journalEntries.length === 0 && (
              <div className="rounded-[24px] border border-dashed border-line bg-white/50 p-6 text-sm text-muted">
                No journal entries yet.
              </div>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
