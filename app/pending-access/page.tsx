import Link from 'next/link';
import { getOptionalClerkUser } from '@/lib/auth';

export default async function PendingAccessPage() {
  const user = await getOptionalClerkUser();
  const email = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses[0]?.emailAddress;

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="shell">
        <section className="panel-strong mx-auto max-w-3xl p-8 md:p-10">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow mb-3">Access Pending</p>
              <h1 className="heading mb-4">Your sign-in worked, but this account is not active in the staff roster yet.</h1>
              <p className="text-muted">
                Ask an admin to add or activate <span className="font-semibold text-foreground">{email || 'your work email'}</span> inside
                the staff access panel.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href="/sign-in" className="button-secondary">
              Back to sign in
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
