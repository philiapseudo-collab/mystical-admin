import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getOptionalStaffUser } from '@/lib/auth';

export default async function HomePage() {
  const authState = await auth();

  if (!authState.userId) {
    redirect('/sign-in');
  }

  const staff = await getOptionalStaffUser();
  redirect(staff ? '/dashboard' : '/pending-access');
}
