import { subDays, startOfDay } from 'date-fns';
import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export default async function AnalyticsPage() {
  await requireStaff();

  const fromDate = startOfDay(subDays(new Date(), 13));

  const [snapshots, packageViewGroups, packages] = await Promise.all([
    prisma.dailyAnalyticsSnapshot.findMany({
      where: {
        date: {
          gte: fromDate,
        },
      },
      orderBy: {
        date: 'asc',
      },
    }),
    prisma.analyticsEvent.groupBy({
      by: ['packageId'],
      where: {
        eventType: 'PACKAGE_VIEW',
        packageId: {
          not: null,
        },
        occurredAt: {
          gte: fromDate,
        },
      },
      _count: {
        packageId: true,
      },
      orderBy: {
        _count: {
          packageId: 'desc',
        },
      },
      take: 5,
    }),
    prisma.catalogPackage.findMany({
      select: {
        id: true,
        title: true,
      },
    }),
  ]);

  const packageMap = new Map(packages.map((pkg) => [pkg.id, pkg.title]));
  const totals = snapshots.reduce(
    (accumulator, snapshot) => ({
      visitors: accumulator.visitors + snapshot.visitors,
      pageViews: accumulator.pageViews + snapshot.pageViews,
      packageViews: accumulator.packageViews + snapshot.packageViews,
      inquiryStarts: accumulator.inquiryStarts + snapshot.inquiryStarts,
      checkoutStarts: accumulator.checkoutStarts + snapshot.checkoutStarts,
      paymentsCompleted: accumulator.paymentsCompleted + snapshot.paymentsCompleted,
    }),
    {
      visitors: 0,
      pageViews: 0,
      packageViews: 0,
      inquiryStarts: 0,
      checkoutStarts: 0,
      paymentsCompleted: 0,
    }
  );

  return (
    <div className="space-y-6">
      <section className="panel-strong p-8">
        <p className="eyebrow mb-3">Funnel Analytics</p>
        <h1 className="heading mb-4">Monitor visits, package interest, inquiry starts, checkout starts, and completed payments.</h1>
        <p className="max-w-3xl text-muted">
          These numbers come from first-party website events stored in the shared database, so the dashboard remains tied to actual public
          user behavior instead of an external-only analytics silo.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {[
          ['Visitors', totals.visitors],
          ['Page views', totals.pageViews],
          ['Package views', totals.packageViews],
          ['Inquiry starts', totals.inquiryStarts],
          ['Checkout starts', totals.checkoutStarts],
          ['Payments completed', totals.paymentsCompleted],
        ].map(([label, value]) => (
          <article key={String(label)} className="metric-card">
            <p className="eyebrow mb-4">{label}</p>
            <p className="font-display text-4xl">{value}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <article className="panel p-6">
          <div className="mb-5">
            <p className="eyebrow mb-2">Daily rollup</p>
            <h2 className="font-display text-3xl">Last 14 days</h2>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Visitors</th>
                  <th>Package views</th>
                  <th>Inquiry starts</th>
                  <th>Checkout starts</th>
                  <th>Payments</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snapshot) => (
                  <tr key={snapshot.id}>
                    <td>{snapshot.date.toDateString()}</td>
                    <td>{snapshot.visitors}</td>
                    <td>{snapshot.packageViews}</td>
                    <td>{snapshot.inquiryStarts}</td>
                    <td>{snapshot.checkoutStarts}</td>
                    <td>{snapshot.paymentsCompleted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel p-6">
          <div className="mb-5">
            <p className="eyebrow mb-2">Top journeys</p>
            <h2 className="font-display text-3xl">Most viewed packages</h2>
          </div>
          <div className="space-y-4">
            {packageViewGroups.map((entry) => (
              <div key={entry.packageId || 'unknown'} className="rounded-[22px] border border-line bg-white/65 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold">{packageMap.get(entry.packageId || '') || 'Unknown package'}</p>
                    <p className="text-sm text-muted">{entry.packageId}</p>
                  </div>
                  <span className="pill">{entry._count.packageId} views</span>
                </div>
              </div>
            ))}
            {packageViewGroups.length === 0 && <p className="text-sm text-muted">No package view data yet.</p>}
          </div>
        </article>
      </section>
    </div>
  );
}
