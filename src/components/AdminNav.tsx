"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/", label: "Dashboard", icon: "⌂" },
  { href: "/kalender", label: "Kalender", icon: "▦" },
  { href: "/indbakke", label: "Indbakke", icon: "✉" },
  { href: "/foreninger", label: "Foreninger", icon: "★" },
  { href: "/faciliteter", label: "Faciliteter", icon: "⌘" },
  { href: "/anmodninger", label: "Anmodninger", icon: "⇄" },
  { href: "/skaerme", label: "Infoskærme", icon: "▣" },
  { href: "/notifikationer", label: "Beskeder", icon: "↻" },
  { href: "/doerkoder", label: "Dørkoder", icon: "🔑" },
];

const EXTERNAL_LINKS = [
  { href: "/pedel", label: "Pedelvisning", icon: "🧹" },
  { href: "/book", label: "Offentlig portal", icon: "🌐" },
];

const COLLAPSE_STORAGE_KEY = "grenaa-admin-nav-collapsed";

export function AdminNav() {
  const pathname = usePathname();
  // Sidepanelet kan slås om til kun at vise ikoner, så der er mere plads til
  // fx facilitetsvisningen i kalenderen med flere kolonner side om side.
  // Tilstanden gemmes lokalt i browseren, så valget huskes næste gang man
  // åbner systemet på samme maskine.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (stored === "1") setCollapsed(true);
    } catch {
      // Ignorer - fx privat browsing hvor localStorage kan fejle
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignorer - ikke kritisk hvis valget ikke kan huskes
      }
      return next;
    });
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex md:flex-col border-r border-slate-200 bg-white transition-[width] duration-150 ${
          collapsed ? "md:w-16" : "md:w-64"
        }`}
      >
        <div className={`border-b border-slate-100 flex items-center ${collapsed ? "justify-center px-2 py-5" : "px-5 py-5"}`}>
          {collapsed ? (
            <span className="text-lg font-semibold text-slate-900" title="Grenaa Idrætscenter Bookingsystem">
              G
            </span>
          ) : (
            <div>
              <div className="text-sm text-slate-400 font-medium">Grenaa Idrætscenter</div>
              <div className="text-lg font-semibold text-slate-900">Bookingsystem</div>
            </div>
          )}
        </div>
        <nav className={`flex-1 py-4 space-y-1 ${collapsed ? "px-2" : "px-3"}`}>
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                title={link.label}
                className={`flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors ${
                  collapsed ? "justify-center px-0" : "px-3"
                } ${active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
              >
                <span className="text-base w-5 text-center shrink-0">{link.icon}</span>
                {!collapsed && link.label}
              </Link>
            );
          })}
        </nav>
        <div className={`border-t border-slate-100 py-4 space-y-1 ${collapsed ? "px-2" : "px-3"}`}>
          {!collapsed && (
            <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Andre visninger
            </div>
          )}
          {EXTERNAL_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              title={link.label}
              className={`flex items-center gap-3 rounded-lg py-2 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-800 ${
                collapsed ? "justify-center px-0" : "px-3"
              }`}
            >
              {collapsed && <span className="text-base w-5 text-center shrink-0">{link.icon}</span>}
              {!collapsed && link.label}
            </Link>
          ))}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Vis fuldt sidepanel" : "Vis kun ikoner"}
            className={`flex items-center gap-3 rounded-lg py-2 text-sm text-slate-400 hover:bg-slate-50 hover:text-slate-700 w-full ${
              collapsed ? "justify-center px-0" : "px-3"
            }`}
          >
            <span className="text-base w-5 text-center shrink-0">{collapsed ? "»" : "«"}</span>
            {!collapsed && "Skjul menu"}
          </button>
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

