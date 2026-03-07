import { TaskSetupMFA } from '@clerk/nextjs';

export default function SetupMfaPage() {
  return (
    <main className="min-h-screen px-4 py-10">
      <div className="shell grid min-h-[88vh] items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="panel-strong p-8 md:p-10">
          <p className="eyebrow mb-4">Security Checkpoint</p>
          <h1 className="heading mb-5 max-w-xl">Finish your multi-factor setup before entering the back office.</h1>
          <p className="max-w-2xl text-muted">
            The admin office uses email-code sign-in plus MFA. Complete the second-factor enrollment here, then you will be returned
            to your office dashboard.
          </p>
        </section>
        <section className="panel p-6 md:p-8">
          <TaskSetupMFA redirectUrlComplete="/dashboard" />
        </section>
      </div>
    </main>
  );
}
