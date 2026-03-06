import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createDepartureAction, updateDepartureStatusAction } from '@/app/(office)/actions';

export default async function DeparturesPage() {
  await requireStaff(['ADMIN', 'OPS']);

  const [packages, departures] = await Promise.all([
    prisma.catalogPackage.findMany({
      where: { visibility: { not: 'ARCHIVED' } },
      orderBy: { title: 'asc' },
    }),
    prisma.departure.findMany({
      include: { package: true, reservations: true },
      orderBy: { startDate: 'asc' },
    }),
  ]);

  return (
    <div className="space-y-6">
      <section className="panel-strong p-8">
        <p className="eyebrow mb-3">Availability Board</p>
        <h1 className="heading mb-4">Control dated departures, capacity, and operational sellability.</h1>
        <p className="max-w-3xl text-muted">
          Dated departures turn a marketing package into a sellable inventory block. The website can surface open seats while operations
          keeps control of when a departure opens or closes.
        </p>
      </section>

      <section className="panel p-6">
        <div className="mb-5">
          <p className="eyebrow mb-2">New departure</p>
          <h2 className="font-display text-3xl">Open a dated inventory block</h2>
        </div>
        <form action={createDepartureAction} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <select name="packageId" className="select" required defaultValue="">
            <option value="" disabled>Select package</option>
            {packages.map((pkg) => (
              <option key={pkg.id} value={pkg.id}>{pkg.title}</option>
            ))}
          </select>
          <input name="name" className="input" placeholder="Departure name (optional)" />
          <input name="code" className="input" placeholder="Departure code (optional)" />
          <input name="startDate" type="date" className="input" required />
          <input name="endDate" type="date" className="input" required />
          <input name="capacity" type="number" min="1" className="input" defaultValue="6" required />
          <input name="pricePerPerson" type="number" min="0" step="0.01" className="input" placeholder="Price per person" />
          <select name="currency" className="select" defaultValue="USD">
            <option value="USD">USD</option>
            <option value="KES">KES</option>
            <option value="TZS">TZS</option>
          </select>
          <input name="depositPercentage" type="number" min="1" max="100" className="input" defaultValue="30" />
          <select name="status" className="select" defaultValue="OPEN">
            <option value="DRAFT">Draft</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </select>
          <textarea name="notes" className="textarea md:col-span-2 xl:col-span-3" placeholder="Internal ops notes" />
          <div className="md:col-span-2 xl:col-span-3 flex justify-end">
            <button type="submit" className="button-primary">Create departure</button>
          </div>
        </form>
      </section>

      <section className="panel p-6">
        <div className="mb-5">
          <p className="eyebrow mb-2">Capacity ledger</p>
          <h2 className="font-display text-3xl">Open and historical departures</h2>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Departure</th>
                <th>Package</th>
                <th>Status</th>
                <th>Seats</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {departures.map((departure) => {
                const reservedSeats = departure.reservations
                  .filter((reservation) => reservation.status === 'HOLD' || reservation.status === 'CONFIRMED')
                  .reduce((sum, reservation) => sum + reservation.guestsCount, 0);
                const openSeats = Math.max(departure.capacity - reservedSeats, 0);

                return (
                  <tr key={departure.id}>
                    <td>
                      <div className="font-medium">{departure.code}</div>
                      <div className="text-xs text-muted">{departure.startDate.toDateString()} to {departure.endDate.toDateString()}</div>
                    </td>
                    <td>{departure.package.title}</td>
                    <td><span className="pill">{departure.status}</span></td>
                    <td>{openSeats} open / {departure.capacity} total</td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        {departure.status !== 'OPEN' && (
                          <form action={updateDepartureStatusAction}>
                            <input type="hidden" name="departureId" value={departure.id} />
                            <input type="hidden" name="status" value="OPEN" />
                            <button type="submit" className="button-secondary">Open</button>
                          </form>
                        )}
                        {departure.status !== 'CLOSED' && (
                          <form action={updateDepartureStatusAction}>
                            <input type="hidden" name="departureId" value={departure.id} />
                            <input type="hidden" name="status" value="CLOSED" />
                            <button type="submit" className="button-secondary">Close</button>
                          </form>
                        )}
                        {departure.status !== 'COMPLETED' && (
                          <form action={updateDepartureStatusAction}>
                            <input type="hidden" name="departureId" value={departure.id} />
                            <input type="hidden" name="status" value="COMPLETED" />
                            <button type="submit" className="button-secondary">Complete</button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {departures.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted">No departures have been created yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
