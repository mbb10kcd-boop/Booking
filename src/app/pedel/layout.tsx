import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { LogoutButton } from "@/components/LogoutButton";

export default async function PedelLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 text-sm">
        <Link href="/" className="text-slate-500 hover:text-slate-800">
          ← Til administration
        </Link>
        <div className="flex items-center gap-3 text-slate-500">
          {user && <span className="truncate max-w-[10rem]">{user.name}</span>}
          <LogoutButton />
        </div>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
