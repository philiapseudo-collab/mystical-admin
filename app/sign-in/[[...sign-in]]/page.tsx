import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main className="min-h-screen px-4 py-10">
      <div className="shell grid min-h-[88vh] items-center lg:grid-cols-[1.1fr_0.9fr] gap-8">
        <section className="panel-strong p-8 md:p-10">
          <p className="eyebrow mb-4">Mystical Admin</p>
          <h1 className="heading mb-5 max-w-xl">Run bookings, departures, finance, and website operations from one control room.</h1>
          <p className="max-w-2xl text-muted">
            Staff access is invite-only. Use your approved work email to continue. If you can authenticate but still lack access,
            an admin needs to activate your staff role and send your invitation inside the back office.
          </p>
        </section>
        <section className="panel p-6 md:p-8">
          <SignIn
            routing="path"
            path="/sign-in"
            signUpUrl="/sign-up"
            fallbackRedirectUrl="/dashboard"
            forceRedirectUrl="/dashboard"
            appearance={{
              elements: {
                cardBox: 'shadow-none border-0 bg-transparent',
              },
            }}
          />
        </section>
      </div>
    </main>
  );
}
