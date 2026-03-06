import { auth, currentUser } from '@clerk/nextjs/server';
import type { StaffRole } from '@prisma/client';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';

export async function getOptionalStaffUser() {
  const authState = await auth();
  if (!authState.userId) {
    return null;
  }

  const user = await currentUser();
  const email = user?.emailAddresses[0]?.emailAddress?.toLowerCase();

  if (!email) {
    return null;
  }

  const staff = await prisma.staffUser.findUnique({
    where: {
      email,
    },
  });

  if (!staff || !staff.active) {
    return null;
  }

  if (staff.clerkUserId !== authState.userId || !staff.lastSeenAt) {
    return prisma.staffUser.update({
      where: {
        id: staff.id,
      },
      data: {
        clerkUserId: authState.userId,
        fullName: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || staff.fullName,
        lastSeenAt: new Date(),
      },
    });
  }

  return staff;
}

export async function requireStaff(allowedRoles?: StaffRole[]) {
  const authState = await auth();

  if (!authState.userId) {
    redirect('/sign-in');
  }

  const user = await currentUser();
  const staff = await getOptionalStaffUser();

  if (!staff) {
    redirect('/pending-access');
  }

  if (allowedRoles && !allowedRoles.includes(staff.role)) {
    redirect('/dashboard');
  }

  return {
    staff,
    user,
  };
}
