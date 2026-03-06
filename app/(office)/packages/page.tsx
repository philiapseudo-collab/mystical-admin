import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { togglePackageVisibilityAction, upsertCatalogPackageAction } from '@/app/(office)/actions';

export default async function PackagesPage() {
  await requireStaff(['ADMIN', 'OPS']);

  const packages = await prisma.catalogPackage.findMany({
    include: { departures: true },
    orderBy: { updatedAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <section className="panel-strong p-8">
        <p className="eyebrow mb-3">Catalog Manager</p>
        <h1 className="heading mb-4">Create, publish, and archive the journeys your public website sells.</h1>
        <p className="max-w-3xl text-muted">
          Archive removes a package from sale without deleting the history connected to bookings, invoices, analytics, or assets.
        </p>
      </section>

      <section className="panel p-6">
        <div className="mb-5">
          <p className="eyebrow mb-2">New package</p>
          <h2 className="font-display text-3xl">Add or refresh a journey</h2>
        </div>
        <form action={upsertCatalogPackageAction} className="grid gap-4 md:grid-cols-2">
          <input name="title" className="input" placeholder="Package title" required />
          <input name="slug" className="input" placeholder="Optional custom slug" />
          <input name="subtitle" className="input" placeholder="Subtitle" />
          <input name="summary" className="input" placeholder="Short summary" />
          <textarea name="description" className="textarea md:col-span-2" placeholder="Long description" required />
          <input name="city" className="input" placeholder="Primary city or region" required />
          <input name="country" className="input" placeholder="Country" defaultValue="Kenya" />
          <input name="duration" className="input" type="number" min="1" defaultValue="3" />
          <input name="maxGroupSize" className="input" type="number" min="1" defaultValue="6" />
          <input name="priceFrom" className="input" type="number" min="0" step="0.01" placeholder="From price" required />
          <select name="currency" className="select" defaultValue="USD">
            <option value="USD">USD</option>
            <option value="KES">KES</option>
            <option value="TZS">TZS</option>
          </select>
          <select name="difficulty" className="select" defaultValue="Easy">
            <option value="Easy">Easy</option>
            <option value="Moderate">Moderate</option>
            <option value="Challenging">Challenging</option>
          </select>
          <select name="visibility" className="select" defaultValue="PUBLISHED">
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          <label className="flex items-center gap-3 rounded-2xl border border-line bg-white/75 px-4 py-3 text-sm">
            <input type="checkbox" name="featured" />
            Mark as featured
          </label>
          <input name="imageUrl" className="input md:col-span-2" placeholder="Hero image URL (optional if uploading)" />
          <input name="heroImage" type="file" accept="image/*" className="input md:col-span-2" />
          <input name="imageAlt" className="input md:col-span-2" placeholder="Image alt text" />
          <textarea name="highlights" className="textarea" placeholder="Highlights, one per line" />
          <textarea name="bestSeasons" className="textarea" placeholder="Best seasons, one per line" />
          <textarea name="inclusions" className="textarea" placeholder="Inclusions, one per line" />
          <textarea name="exclusions" className="textarea" placeholder="Exclusions, one per line" />
          <div className="md:col-span-2 flex justify-end">
            <button type="submit" className="button-primary">Save package</button>
          </div>
        </form>
      </section>

      <section className="panel p-6">
        <div className="mb-5">
          <p className="eyebrow mb-2">Shared catalog</p>
          <h2 className="font-display text-3xl">Current packages</h2>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Package</th>
                <th>Visibility</th>
                <th>From</th>
                <th>Departures</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {packages.map((pkg) => (
                <tr key={pkg.id}>
                  <td>
                    <div className="font-medium">{pkg.title}</div>
                    <div className="text-xs text-muted">{pkg.slug}</div>
                  </td>
                  <td><span className="pill">{pkg.visibility}</span></td>
                  <td>{pkg.currency} {pkg.priceFrom.toFixed(0)}</td>
                  <td>{pkg.departures.length}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      {pkg.visibility !== 'PUBLISHED' && (
                        <form action={togglePackageVisibilityAction}>
                          <input type="hidden" name="packageId" value={pkg.id} />
                          <input type="hidden" name="visibility" value="PUBLISHED" />
                          <button type="submit" className="button-secondary">Publish</button>
                        </form>
                      )}
                      {pkg.visibility !== 'ARCHIVED' && (
                        <form action={togglePackageVisibilityAction}>
                          <input type="hidden" name="packageId" value={pkg.id} />
                          <input type="hidden" name="visibility" value="ARCHIVED" />
                          <button type="submit" className="button-secondary">Archive</button>
                        </form>
                      )}
                      {pkg.visibility === 'ARCHIVED' && (
                        <form action={togglePackageVisibilityAction}>
                          <input type="hidden" name="packageId" value={pkg.id} />
                          <input type="hidden" name="visibility" value="DRAFT" />
                          <button type="submit" className="button-secondary">Move to draft</button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {packages.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted">No packages in the shared catalog yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
