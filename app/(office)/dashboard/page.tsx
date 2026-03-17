import { startOfDay, startOfMonth } from 'date-fns';
import { CalendarDays, Coins, CreditCard, Eye, Ticket, TrendingUp } from 'lucide-react';
import { requireStaff } from '@/lib/auth';
import { getBookingJourneyLabel } from '@/lib/bookings';
import { prisma } from '@/lib/prisma';

function getUtcDayStart(date: Date) {
  const normalized = new Date(date);
  normalized.setUTCHours(0, 0, 0, 0);
  return normalized;
}

function formatCurrency(amount: number, currency = 'KES') {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default async function DashboardPage() {
  await requireStaff();

  const now = new Date();
  const analyticsDay = getUtcDayStart(now);
  const today = startOfDay(now);
  const monthStart = startOfMonth(now);

  const [todaySnapshot, departures, bookingsToday, recentBookings, dueInvoices, completedPayments, manualPayments, postedExpenses] =
    await Promise.all([
      prisma.dailyAnalyticsSnapshot.findUnique({ where: { date: analyticsDay } }),
      prisma.departure.findMany({ where: { status: 'OPEN' }, include: { reservations: true } }),
      prisma.booking.count({ where: { createdAt: { gte: today } } }),
      prisma.booking.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        include: { catalogPackage: true, invoices: true },
      }),
      prisma.invoice.aggregate({
        where: { status: { in: ['issued', 'pending'] } },
        _sum: { dueAmount: true },
      }),
      prisma.paymentAttempt.aggregate({
        where: { status: 'completed', completedAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      prisma.manualPayment.aggregate({
        where: { receivedAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: { status: 'POSTED', incurredAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
    ]);

  const seatsReserved = departures.reduce(
    (sum, departure) =>
      sum +
      departure.reservations
        .filter((reservation) => reservation.status === 'HOLD' || reservation.status === 'CONFIRMED')
        .reduce((reservationSum, reservation) => reservationSum + reservation.guestsCount, 0),
    0
  );
  const openSeats = departures.reduce((sum, departure) => sum + departure.capacity, 0) - seatsReserved;
  const moneyIn = (completedPayments._sum.amount || 0) + (manualPayments._sum.amount || 0);
  const moneyOut = postedExpenses._sum.amount || 0;

  const metrics = [
    { label: 'Today visitors', value: `${todaySnapshot?.visitors || 0}`, detail: `${todaySnapshot?.pageViews || 0} page views`, icon: Eye },
    { label: 'Bookings today', value: `${bookingsToday}`, detail: `${recentBookings.length} shown below`, icon: Ticket },
    { label: 'Open departures', value: `${departures.length}`, detail: `${Math.max(openSeats, 0)} seats open`, icon: CalendarDays },
    { label: 'Cash in this month', value: formatCurrency(moneyIn), detail: `Cash out ${formatCurrency(moneyOut)}`, icon: TrendingUp },
    { label: 'Outstanding balances', value: formatCurrency(dueInvoices._sum.dueAmount || 0), detail: 'Issued and pending invoices', icon: CreditCard },
    { label: 'Margin signal', value: formatCurrency(moneyIn - moneyOut), detail: 'In minus out this month', icon: Coins },
  ];

  return (
    <div className="space-y-6">
      <section className="panel-strong p-8">
        <p className="eyebrow mb-3">Operating Snapshot</p>
        <h1 className="heading mb-4">See demand, departures, and cash movement from the same source of truth.</h1>
        <p className="max-w-3xl text-muted">
          This dashboard merges first-party website activity with bookings, departures, and finance records so the public website and
          back office remain synchronized.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <article key={metric.label} className="metric-card">
              <div className="mb-5 flex items-center justify-between">
                <p className="eyebrow">{metric.label}</p>
                <Icon className="h-5 w-5 text-accent" />
              </div>
              <p className="font-display text-4xl">{metric.value}</p>
              <p className="mt-3 text-sm text-muted">{metric.detail}</p>
            </article>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="panel p-6">
          <div className="mb-5">
            <p className="eyebrow mb-2">Recent bookings</p>
            <h2 className="font-display text-3xl">Live queue</h2>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Journey</th>
                  <th>Status</th>
                  <th>Payment</th>
                </tr>
              </thead>
              <tbody>
                {recentBookings.map((booking) => (
                  <tr key={booking.id}>
                    <td>{booking.bookingReference}</td>
                    <td>
                      <div className="font-medium">
                        {getBookingJourneyLabel({
                          catalogPackageTitle: booking.catalogPackage?.title,
                          items: booking.items,
                          guestDetails: booking.guestDetails,
                        })}
                      </div>
                      <div className="text-xs text-muted">{booking.channel}</div>
                    </td>
                    <td><span className="pill">{booking.status}</span></td>
                    <td>{booking.paymentStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel p-6">
          <p className="eyebrow mb-2">Availability</p>
          <h2 className="font-display text-3xl mb-5">Open departures</h2>
          <div className="space-y-4">
            {departures.slice(0, 5).map((departure) => {
              const heldSeats = departure.reservations
                .filter((reservation) => reservation.status === 'HOLD' || reservation.status === 'CONFIRMED')
                .reduce((sum, reservation) => sum + reservation.guestsCount, 0);
              return (
                <div key={departure.id} className="rounded-[22px] border border-line bg-white/65 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-semibold">{departure.code}</p>
                      <p className="text-sm text-muted">{departure.startDate.toDateString()}</p>
                    </div>
                    <span className="pill">{Math.max(departure.capacity - heldSeats, 0)} open</span>
                  </div>
                </div>
              );
            })}
            {departures.length === 0 && <p className="text-sm text-muted">No open departures yet.</p>}
          </div>
        </article>
      </section>
    </div>
  );
}
