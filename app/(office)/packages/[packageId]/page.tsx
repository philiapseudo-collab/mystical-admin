import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  removePackageAssetAction,
  setPrimaryPackageAssetAction,
  togglePackageVisibilityAction,
  upsertCatalogPackageAction,
} from '@/app/(office)/actions';

function asLines(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').join('\n') : '';
}

function asLocations(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    return { city: '', country: 'Kenya' };
  }

  const first = value[0];
  if (typeof first !== 'object' || first === null) {
    return { city: '', country: 'Kenya' };
  }

  return {
    city: typeof first.city === 'string' ? first.city : '',
    country: typeof first.country === 'string' ? first.country : 'Kenya',
  };
}

export default async function PackageEditorPage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  await requireStaff(['ADMIN', 'OPS']);
  const { packageId } = await params;

  const pkg = await prisma.catalogPackage.findUnique({
    where: {
      id: packageId,
    },
    include: {
      assets: {
        orderBy: {
          sortOrder: 'asc',
        },
      },
      departures: {
        include: {
          reservations: true,
        },
        orderBy: {
          startDate: 'asc',
        },
      },
    },
  });

  if (!pkg) {
    notFound();
  }

  const locations = asLocations(pkg.locations);

  return (
    <div className="space-y-6">
      <section className="panel-strong p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow mb-3">Package Editor</p>
            <h1 className="heading mb-4">Refine the public journey page without leaving the back office.</h1>
            <p className="max-w-3xl text-muted">
              Update copy, pricing, visibility, and media here. Archive keeps operational history intact while removing the package from sale.
            </p>
          </div>
          <Link href="/packages" className="button-secondary">
            Back to packages
          </Link>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <article className="panel p-6">
          <div className="mb-5">
            <p className="eyebrow mb-2">Package details</p>
            <h2 className="font-display text-3xl">Edit {pkg.title}</h2>
          </div>
          <form action={upsertCatalogPackageAction} className="grid gap-4 md:grid-cols-2">
            <input type="hidden" name="packageId" value={pkg.id} />
            <input name="title" className="input" placeholder="Package title" defaultValue={pkg.title} required />
            <input name="slug" className="input" placeholder="Slug" defaultValue={pkg.slug} />
            <input name="subtitle" className="input" placeholder="Subtitle" defaultValue={pkg.subtitle} />
            <input name="summary" className="input" placeholder="Short summary" defaultValue={pkg.summary || ''} />
            <textarea
              name="description"
              className="textarea md:col-span-2"
              placeholder="Long description"
              defaultValue={pkg.description}
              required
            />
            <input name="city" className="input" placeholder="Primary city or region" defaultValue={locations.city} required />
            <input name="country" className="input" placeholder="Country" defaultValue={locations.country} />
            <input name="duration" className="input" type="number" min="1" defaultValue={pkg.duration} />
            <input name="maxGroupSize" className="input" type="number" min="1" defaultValue={pkg.maxGroupSize} />
            <input name="priceFrom" className="input" type="number" min="0" step="0.01" defaultValue={pkg.priceFrom} required />
            <select name="currency" className="select" defaultValue={pkg.currency}>
              <option value="USD">USD</option>
              <option value="KES">KES</option>
              <option value="TZS">TZS</option>
            </select>
            <select name="difficulty" className="select" defaultValue={pkg.difficulty}>
              <option value="Easy">Easy</option>
              <option value="Moderate">Moderate</option>
              <option value="Challenging">Challenging</option>
            </select>
            <select name="visibility" className="select" defaultValue={pkg.visibility}>
              <option value="DRAFT">Draft</option>
              <option value="PUBLISHED">Published</option>
              <option value="ARCHIVED">Archived</option>
            </select>
            <label className="flex items-center gap-3 rounded-2xl border border-line bg-white/75 px-4 py-3 text-sm">
              <input type="checkbox" name="featured" defaultChecked={pkg.featured} />
              Mark as featured
            </label>
            <input name="imageUrl" className="input md:col-span-2" placeholder="Add image URL (optional)" />
            <input name="heroImage" type="file" accept="image/*" className="input md:col-span-2" />
            <input name="imageAlt" className="input md:col-span-2" placeholder="Alt text for new image" defaultValue={pkg.title} />
            <textarea name="highlights" className="textarea" placeholder="Highlights, one per line" defaultValue={asLines(pkg.highlights)} />
            <textarea name="bestSeasons" className="textarea" placeholder="Best seasons, one per line" defaultValue={asLines(pkg.bestSeasons)} />
            <textarea name="inclusions" className="textarea" placeholder="Inclusions, one per line" defaultValue={asLines(pkg.inclusions)} />
            <textarea name="exclusions" className="textarea" placeholder="Exclusions, one per line" defaultValue={asLines(pkg.exclusions)} />
            <div className="md:col-span-2 flex justify-end">
              <button type="submit" className="button-primary">Save changes</button>
            </div>
          </form>
        </article>

        <div className="space-y-6">
          <article className="panel p-6">
            <div className="mb-5">
              <p className="eyebrow mb-2">Visibility</p>
              <h2 className="font-display text-3xl">Sales state</h2>
            </div>
            <div className="space-y-3">
              <div className="rounded-[24px] border border-line bg-white/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted">Current status</p>
                <p className="mt-2 text-2xl font-display text-foreground">{pkg.visibility}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {pkg.visibility !== 'PUBLISHED' && (
                  <form action={togglePackageVisibilityAction}>
                    <input type="hidden" name="packageId" value={pkg.id} />
                    <input type="hidden" name="visibility" value="PUBLISHED" />
                    <button type="submit" className="button-secondary">Publish</button>
                  </form>
                )}
                {pkg.visibility !== 'DRAFT' && (
                  <form action={togglePackageVisibilityAction}>
                    <input type="hidden" name="packageId" value={pkg.id} />
                    <input type="hidden" name="visibility" value="DRAFT" />
                    <button type="submit" className="button-secondary">Move to draft</button>
                  </form>
                )}
                {pkg.visibility !== 'ARCHIVED' && (
                  <form action={togglePackageVisibilityAction}>
                    <input type="hidden" name="packageId" value={pkg.id} />
                    <input type="hidden" name="visibility" value="ARCHIVED" />
                    <button type="submit" className="button-secondary">Archive</button>
                  </form>
                )}
              </div>
            </div>
          </article>

          <article className="panel p-6">
            <div className="mb-5">
              <p className="eyebrow mb-2">Media</p>
              <h2 className="font-display text-3xl">Gallery assets</h2>
            </div>
            <div className="space-y-4">
              {pkg.assets.map((asset) => (
                <div key={asset.id} className="rounded-[24px] border border-line bg-white/70 p-4">
                  <div className="mb-4 aspect-[16/10] overflow-hidden rounded-[20px] bg-slate-100">
                    <img src={asset.url} alt={asset.alt} className="h-full w-full object-cover" />
                  </div>
                  <div className="mb-3">
                    <p className="text-sm font-medium text-foreground">{asset.alt}</p>
                    <p className="text-xs text-muted">{asset.isPrimary ? 'Primary image' : `Sort order ${asset.sortOrder}`}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!asset.isPrimary && (
                      <form action={setPrimaryPackageAssetAction}>
                        <input type="hidden" name="packageId" value={pkg.id} />
                        <input type="hidden" name="assetId" value={asset.id} />
                        <button type="submit" className="button-secondary">Set primary</button>
                      </form>
                    )}
                    <form action={removePackageAssetAction}>
                      <input type="hidden" name="packageId" value={pkg.id} />
                      <input type="hidden" name="assetId" value={asset.id} />
                      <button type="submit" className="button-secondary">Remove</button>
                    </form>
                  </div>
                </div>
              ))}
              {pkg.assets.length === 0 && (
                <div className="rounded-[24px] border border-dashed border-line bg-white/50 p-6 text-sm text-muted">
                  No images attached yet. Upload a hero image in the editor form to create the first asset.
                </div>
              )}
            </div>
          </article>

          <article className="panel p-6">
            <div className="mb-5">
              <p className="eyebrow mb-2">Linked departures</p>
              <h2 className="font-display text-3xl">Inventory impact</h2>
            </div>
            <div className="space-y-3">
              {pkg.departures.map((departure) => {
                const reservedSeats = departure.reservations
                  .filter((reservation) => reservation.status === 'HOLD' || reservation.status === 'CONFIRMED')
                  .reduce((sum, reservation) => sum + reservation.guestsCount, 0);

                return (
                  <div key={departure.id} className="rounded-[22px] border border-line bg-white/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{departure.code}</p>
                        <p className="text-sm text-muted">
                          {departure.startDate.toLocaleDateString()} to {departure.endDate.toLocaleDateString()}
                        </p>
                      </div>
                      <span className="pill">{departure.status}</span>
                    </div>
                    <p className="mt-3 text-sm text-muted">
                      {Math.max(departure.capacity - reservedSeats, 0)} open / {departure.capacity} seats
                    </p>
                  </div>
                );
              })}
              {pkg.departures.length === 0 && (
                <div className="rounded-[24px] border border-dashed border-line bg-white/50 p-6 text-sm text-muted">
                  No dated departures yet. Create one in the departures module when this package needs seat-based inventory.
                </div>
              )}
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
