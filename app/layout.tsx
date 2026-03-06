import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { Fraunces, Space_Grotesk } from 'next/font/google';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
});

const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';

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
    <ClerkProvider>
      <html lang="en">
        <body className={`${spaceGrotesk.variable} ${fraunces.variable}`}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
