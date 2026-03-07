# Mystical Admin

Back-office PWA for Mystical Vacations. The app manages packages, departures, bookings, analytics, finance, and staff access against the shared PostgreSQL database used by the public website.

## Stack

- Next.js App Router
- Prisma + PostgreSQL
- Clerk authentication
- Cloudinary uploads
- Railway deployment

## Local setup

```bash
npm install
npm run dev
```

Required environment variables are listed in [.env.example](D:\projects-2\mystical-admin\.env.example).

## Security model

- Authentication is handled by Clerk.
- Authorization is handled by the local `staff_users` table and staff roles.
- Staff onboarding is invite-only from the `/staff` screen.
- The app shell exposes sign-in only. Sign-up exists only to accept Clerk invitations.
- Optional domain allowlisting is controlled with `ALLOWED_STAFF_EMAIL_DOMAINS`.

## Clerk policy

To match the intended production policy, configure the Clerk instance with:

1. Restricted sign-up mode
2. Email code as the primary email authentication strategy
3. Required multi-factor authentication

The app is already wired for those settings:

- `/sign-up` accepts invitation-based sign-ups
- `/session-tasks/setup-mfa` handles Clerk MFA session tasks
- signed-in users are redirected to outstanding Clerk tasks before entering the office

## Useful scripts

```bash
npm run dev
npm run build
npm run lint
npm run db:migrate
```
