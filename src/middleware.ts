import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

// Sider der IKKE kræver login: den offentlige bookingportal (foreninger og
// privatpersoner), de fysiske infoskærme (ingen logger ind på dem - de
// hænger bare på væggen), og selve login-siden.
const PUBLIC_PAGE_PREFIXES = ["/login", "/book", "/skaerm", "/aflysninger"];

// API-endpoints den offentlige portal og infoskærmene selv kalder, og som
// derfor skal virke uden en indlogget session. Alt andet under /api/ kræver
// login som udgangspunkt (deny-by-default er sikrere end at forsøge at
// opremse alle de interne endpoints, der SKAL beskyttes).
const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/portal/", "/api/public/"];

function isPublicApiPath(pathname: string, method: string): boolean {
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // Facilitetslisten skal kunne læses af den offentlige portal (til at vælge
  // facilitet), men oprettelse/redigering af faciliteter (POST/PATCH/DELETE)
  // er stadig kun for personalet.
  if (pathname === "/api/facilities" && method === "GET") return true;
  // Konflikttjek bruges af portalen, inden en booking oprettes.
  if (pathname === "/api/bookings/check-conflict" && method === "POST") return true;
  // De fysiske infoskærme henter deres eget indhold via /api/screens/<id>.
  if (/^\/api\/screens\/[^/]+$/.test(pathname) && method === "GET") return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  const isPublic = isApi
    ? isPublicApiPath(pathname, req.method)
    : PUBLIC_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (isPublic) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(token);

  if (session) return NextResponse.next();

  if (isApi) {
    return NextResponse.json({ error: "Ikke logget ind" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
