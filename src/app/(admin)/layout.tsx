import { AdminNav } from "@/components/AdminNav";
import { getSessionUser } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <div className="flex flex-1 min-h-screen">
      <AdminNav user={user ? { name: user.name, email: user.email, role: user.role } : null} />
      <main className="flex-1 min-w-0 pb-20 md:pb-0">{children}</main>
    </div>
  );
}
