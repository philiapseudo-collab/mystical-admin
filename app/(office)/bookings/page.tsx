import Link from 'next/link';
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

export default async function BookingsPage() {
  const { staff } = await requireStaff(['ADMIN', 'OPS']);

  const bookings = await prisma.booking.findMany({
    include: {
      catalogPackage: true,
      departure: true,
      invoices: {
        orderBy: {
          createdAt: 'desc',
        },
      },
      manualPayments: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 30,
  });

  return (
    <div className="space-y-6">
      <section className="panel-strong p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="eyebrow mb-3">Booking Operations</p>
            <h1 className="heading mb-4">Track website and manual bookings with their linked departures, invoices, and payment progress.</h1>
            <p className="max-w-3xl text-muted">
              The booking list below is sourced from the same records the public website writes into. Manual payments and departure links are
              visible here so operations can reconcile space and traveler status quickly.
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
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Journey</th>
                <th>Departure</th>
                <th>Status</th>
                <th>Invoices</th>
                <th>Manual receipts</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => (
                <tr key={booking.id}>
                  <td>
                    <div className="font-medium">{booking.bookingReference}</div>
                    <div className="text-xs text-muted">{booking.channel}</div>
                  </td>
                  <td>{getBookingJourneyLabel({ catalogPackageTitle: booking.catalogPackage?.title, items: booking.items, guestDetails: booking.guestDetails })}</td>
                  <td>{booking.departure?.code || 'No departure linked'}</td>
                  <td>
                    <div className="space-y-1">
                      <span className="pill">{booking.status}</span>
                      <div className="text-xs text-muted">{booking.paymentStatus}</div>
                    </div>
                  </td>
                  <td>
                    <div className="space-y-2">
                      {booking.invoices.map((invoice) => (
                        <div key={invoice.id} className="text-xs text-muted">
                          <span className="font-semibold text-foreground">{invoice.invoiceNumber}</span> - {invoice.type} - {invoice.status} -{' '}
                          {formatCurrency(invoice.dueAmount, invoice.currency)}
                        </div>
                      ))}
                      {booking.invoices.length === 0 && <span className="text-xs text-muted">No invoices yet</span>}
                    </div>
                  </td>
                  <td>
                    <div className="space-y-2">
                      {booking.manualPayments.map((payment) => (
                        <div key={payment.id} className="text-xs text-muted">
                          <span className="font-semibold text-foreground">{payment.channel}</span> - {formatCurrency(payment.amount, payment.currency)}
                        </div>
                      ))}
                      {booking.manualPayments.length === 0 && <span className="text-xs text-muted">None</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {bookings.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-muted">No bookings yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
