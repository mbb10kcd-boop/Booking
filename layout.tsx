import { AdminNav } from "@/components/AdminNav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 min-h-screen">
      <AdminNav />
      <main className="flex-1 min-w-0 pb-20 md:pb-0">{children}</main>
    </div>
  );
}
