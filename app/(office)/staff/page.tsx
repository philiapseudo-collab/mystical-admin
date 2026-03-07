import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createStaffAccessAction } from '@/app/(office)/actions';
import { getAllowedStaffDomains } from '@/lib/security';

export default async function StaffPage() {
  await requireStaff(['ADMIN']);
  const allowedDomains = getAllowedStaffDomains();

  const [staffUsers, auditLogs] = await Promise.all([
    prisma.staffUser.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    }),
    prisma.auditLog.findMany({
      take: 20,
      orderBy: {
        createdAt: 'desc',
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <section className="panel-strong p-8">
        <p className="eyebrow mb-3">Staff Access</p>
        <h1 className="heading mb-4">Manage role-based access for Admin, Ops, and Finance users.</h1>
        <p className="max-w-3xl text-muted">
          Sign-in is handled by Clerk, but only invited email addresses in this staff roster gain actual access to the admin back office.
        </p>
        {allowedDomains.length ? (
          <p className="mt-3 text-sm text-muted">
            Domain policy: invites and access are limited to <span className="font-semibold text-foreground">{allowedDomains.join(', ')}</span>.
          </p>
        ) : null}
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <article className="panel p-6">
          <div className="mb-4">
            <p className="eyebrow mb-2">Grant access</p>
            <h2 className="font-display text-2xl">Add or update staff</h2>
          </div>
          <form action={createStaffAccessAction} className="space-y-3">
            <input name="fullName" className="input" placeholder="Full name" />
            <input name="email" className="input" type="email" placeholder="work@email.com" required />
            <select name="role" className="select" defaultValue="OPS">
              <option value="ADMIN">Admin</option>
              <option value="OPS">Ops</option>
              <option value="FINANCE">Finance</option>
            </select>
            <label className="flex items-center gap-3 rounded-2xl border border-line bg-white/75 px-4 py-3 text-sm">
              <input type="checkbox" name="active" defaultChecked />
              Active staff record
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-line bg-white/75 px-4 py-3 text-sm">
              <input type="checkbox" name="sendInvite" defaultChecked />
              Send or resend invitation email
            </label>
            <button type="submit" className="button-primary w-full">Save staff access</button>
          </form>
        </article>

        <article className="panel p-6">
          <div className="mb-5">
            <p className="eyebrow mb-2">Current roster</p>
            <h2 className="font-display text-3xl">Who can do what</h2>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {staffUsers.map((staffUser) => (
                  <tr key={staffUser.id}>
                    <td>{staffUser.fullName || 'Unnamed staff'}</td>
                    <td>{staffUser.email}</td>
                    <td><span className="pill">{staffUser.role}</span></td>
                    <td>{staffUser.active ? 'Active' : 'Disabled'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="panel p-6">
        <div className="mb-5">
          <p className="eyebrow mb-2">Recent audit activity</p>
          <h2 className="font-display text-3xl">Change trail</h2>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td>{log.createdAt.toLocaleString()}</td>
                  <td>{log.action}</td>
                  <td>{log.entityType}</td>
                  <td>{log.entityId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
