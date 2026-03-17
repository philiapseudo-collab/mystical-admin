import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ManualBookingForm } from './manual-booking-form';

export default async function NewManualBookingPage() {
  await requireStaff(['ADMIN']);

  const [packages, departures, vendors] = await Promise.all([
    prisma.catalogPackage.findMany({
      where: {
        visibility: {
          not: 'ARCHIVED',
        },
      },
      orderBy: {
        title: 'asc',
      },
      select: {
        id: true,
        title: true,
        currency: true,
        priceFrom: true,
      },
    }),
    prisma.departure.findMany({
      where: {
        status: 'OPEN',
      },
      orderBy: {
        startDate: 'asc',
      },
      include: {
        package: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    }),
    prisma.vendor.findMany({
      where: {
        status: 'ACTIVE',
      },
      orderBy: {
        name: 'asc',
      },
      select: {
        id: true,
        name: true,
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <section className="panel-strong p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="eyebrow mb-3">Manual Booking</p>
            <h1 className="heading mb-4">Create an off-website booking, its invoice schedule, direct costs, and owner payouts in one flow.</h1>
            <p className="max-w-3xl text-muted">
              Use this when the sale happened through phone, WhatsApp, walk-in, referral, or any channel outside the public checkout.
            </p>
          </div>
          <Link href="/bookings" className="button-secondary">
            Back to bookings
          </Link>
        </div>
      </section>

      <ManualBookingForm
        packages={packages}
        departures={departures.map((departure) => ({
          id: departure.id,
          code: departure.code,
          packageId: departure.package.id,
          packageTitle: departure.package.title,
          startDate: departure.startDate.toISOString(),
        }))}
        vendors={vendors}
      />
    </div>
  );
}
