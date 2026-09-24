import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, role, company, memberships, permissions } = await getSession();

  // senha criada por um administrador: troca antes de entrar no sistema
  if (user.must_change_password) redirect("/trocar-senha");

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
