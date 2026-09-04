import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, role, company, memberships, permissions } = await getSession();

  return (
    <AppShell
      user={user}
      role={role}
      company={company}
      memberships={memberships}
      permissions={[...permissions]}
    >
      {children}
    </AppShell>
  );
}
