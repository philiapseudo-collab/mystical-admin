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

export default async function FinancePage() {
  await requireStaff(['ADMIN', 'FINANCE']);

  const [vendors, bookings, invoices, expenses, manualPayments] = await Promise.all([
    prisma.vendor.findMany({ orderBy: { name: 'asc' } }),
    prisma.booking.findMany({
      include: { catalogPackage: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.invoice.findMany({
      where: { status: { in: ['issued', 'pending'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.expense.findMany({
      include: { vendor: true },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
    prisma.manualPayment.findMany({
      include: { booking: true },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
  ]);

  return (
    <div className="space-y-6">
      <section className="panel-strong p-8">
        <p className="eyebrow mb-3">Finance Console</p>
        <h1 className="heading mb-4">Record direct payments, vendor costs, and accounting-side operational activity.</h1>
        <p className="max-w-3xl text-muted">
          This release includes internal ledger posting and export-friendly structures, but not external accounting software sync or payroll.
        </p>
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
                <option key={booking.id} value={booking.id}>{booking.bookingReference}</option>
              ))}
            </select>
            <select name="invoiceId" className="select" defaultValue="">
              <option value="">No linked invoice</option>
              {invoices.map((invoice) => (
                <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber}</option>
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

      <section className="grid gap-6 xl:grid-cols-2">
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
                    <td>{expense.description}</td>
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
      </section>
    </div>
  );
}
