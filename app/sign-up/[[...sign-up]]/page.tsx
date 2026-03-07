import Link from 'next/link';
import { SignUp } from '@clerk/nextjs';

type SignUpPageProps = {
  searchParams: Promise<{
    __clerk_ticket?: string | string[];
  }>;
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const params = await searchParams;
  const invitationTicket = Array.isArray(params.__clerk_ticket) ? params.__clerk_ticket[0] : params.__clerk_ticket;

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="shell grid min-h-[88vh] items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="panel-strong p-8 md:p-10">
          <p className="eyebrow mb-4">Invitation Only</p>
          <h1 className="heading mb-5 max-w-xl">Complete your staff invitation to access bookings, departures, finance, and website operations.</h1>
          <p className="max-w-2xl text-muted">
            Mystical Admin is not open for public sign-up. Use the invitation email sent by an admin, then finish your email-code
            sign-in and multi-factor setup here.
          </p>
        </section>
        <section className="panel p-6 md:p-8">
          {invitationTicket ? (
            <SignUp
              routing="path"
              path="/sign-up"
              signInUrl="/sign-in"
              fallbackRedirectUrl="/dashboard"
              forceRedirectUrl="/dashboard"
              appearance={{
                elements: {
                  cardBox: 'shadow-none border-0 bg-transparent',
                },
              }}
            />
          ) : (
            <div className="space-y-4">
              <h2 className="font-display text-3xl text-foreground">Invitation required</h2>
              <p className="text-muted">
                Direct sign-up is disabled. Open the invitation email sent by an admin, then return here from that secure link.
              </p>
              <Link href="/sign-in" className="button-secondary inline-flex">
                Back to sign in
              </Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
