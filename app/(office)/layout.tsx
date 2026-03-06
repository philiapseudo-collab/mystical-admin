import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { BarChart3, BriefcaseBusiness, CalendarDays, CreditCard, LayoutDashboard, Package2, ShieldCheck } from 'lucide-react';
import { requireStaff } from '@/lib/auth';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/packages', label: 'Packages', icon: Package2 },
  { href: '/departures', label: 'Departures', icon: CalendarDays },
  { href: '/bookings', label: 'Bookings', icon: BriefcaseBusiness },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/finance', label: 'Finance', icon: CreditCard },
  { href: '/staff', label: 'Staff', icon: ShieldCheck },
];

export default async function OfficeLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { staff, user } = await requireStaff();
  const firstName = user?.firstName || staff.fullName || 'Team';

  return (
    <div className="shell py-4 md:py-6">
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="panel p-5">
          <div className="mb-8">
            <p className="eyebrow mb-3">Mystical Admin</p>
            <h1 className="font-display text-3xl text-foreground">Back Office</h1>
            <p className="mt-3 text-sm text-muted">Shared control plane for bookings, availability, finance, and website operations.</p>
          </div>

          <div className="mb-8 rounded-[24px] bg-forest px-4 py-5 text-white">
            <p className="text-xs uppercase tracking-[0.22em] text-white/60">Signed in</p>
            <p className="mt-2 text-2xl font-display">{firstName}</p>
            <p className="mt-2 text-sm text-white/75">{staff.email}</p>
            <span className="mt-4 inline-flex rounded-full bg-white/12 px-3 py-1 text-xs uppercase tracking-[0.18em]">
              {staff.role}
            </span>
          </div>

          <nav className="space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className="nav-link">
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-10 flex items-center justify-between rounded-[22px] border border-line bg-white/60 px-4 py-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted">Session</p>
              <p className="text-sm font-medium text-foreground">Managed by Clerk</p>
            </div>
            <UserButton />
          </div>
        </aside>

        <main className="space-y-6">{children}</main>
      </div>
    </div>
  );
}
