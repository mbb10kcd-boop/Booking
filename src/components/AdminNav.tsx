"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard", icon: "⌂" },
  { href: "/kalender", label: "Kalender", icon: "▦" },
  { href: "/indbakke", label: "Indbakke", icon: "✉" },
  { href: "/foreninger", label: "Foreninger", icon: "★" },
  { href: "/faciliteter", label: "Faciliteter", icon: "⌘" },
  { href: "/skaerme", label: "Infoskærme", icon: "▣" },
  { href: "/notifikationer", label: "Beskeder", icon: "↻" },
];

const EXTERNAL_LINKS = [
  { href: "/pedel", label: "Pedelvisning" },
  { href: "/book", label: "Offentlig portal" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col border-r border-slate-200 bg-white">
        <div className="px-5 py-5 border-b border-slate-100">
          <div className="text-sm text-slate-400 font-medium">Grenaa Idrætscenter</div>
          <div className="text-lg font-semibold text-slate-900">Bookingsystem</div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <span className="text-base w-5 text-center">{link.icon}</span>
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 py-4 border-t border-slate-100 space-y-1">
          <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Andre visninger
          </div>
          {EXTERNAL_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 flex justify-around py-1.5">
        {LINKS.slice(0, 5).map((link) => {
          const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-medium rounded-lg ${
                active ? "text-blue-700" : "text-slate-500"
              }`}
            >
              <span className="text-lg leading-none">{link.icon}</span>
              {link.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
