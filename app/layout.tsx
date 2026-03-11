import type { Metadata } from 'next';
import { ClerkProvider, RedirectToTasks, Show, SignInButton, UserButton } from '@clerk/nextjs';
import { Fraunces, Space_Grotesk } from 'next/font/google';
import { getAppUrl } from '@/lib/app-url';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
});

const appUrl = getAppUrl();

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: 'Mystical Admin',
    template: '%s | Mystical Admin',
  },
  description: 'Back office PWA for Mystical Vacations bookings, departures, analytics, and finance.',
  applicationName: 'Mystical Admin',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Mystical Admin',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} ${fraunces.variable}`}>
        <ClerkProvider taskUrls={{ 'setup-mfa': '/session-tasks/setup-mfa' }}>
          <Show when="signed-in">
            <RedirectToTasks />
          </Show>
          <header className="border-b border-line bg-white/70 backdrop-blur-sm">
            <div className="shell flex items-center justify-between gap-4 py-4">
              <div>
                <p className="eyebrow">Mystical Admin</p>
              </div>
              <div className="flex items-center gap-3">
                <Show when="signed-out">
                  <SignInButton mode="modal">
                    <button type="button" className="button-secondary">Sign in</button>
                  </SignInButton>
                </Show>
                <Show when="signed-in">
                  <UserButton />
                </Show>
              </div>
            </div>
          </header>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
