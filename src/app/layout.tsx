import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grenaa Idrætscenter - Booking",
  description: "Bookingsystem til Grenaa Idrætscenter",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
