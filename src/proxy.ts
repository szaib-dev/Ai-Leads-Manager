import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { safeReturnTo } from "@/lib/auth/return-to";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = getSupabaseConfig();
  let authenticated = false;
  if (config) {
    const client = createServerClient<Database>(config.url, config.key, {
      cookieOptions: {
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          const previous = response.cookies.getAll();
          response = NextResponse.next({ request });
          previous.forEach((cookie) => response.cookies.set(cookie));
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });
    try {
      const { data, error } = await client.auth.getClaims();
      authenticated = !error && !!data?.claims.sub;
    } catch {
      authenticated = false;
    }
  }
  if (request.nextUrl.pathname.startsWith("/dash") && !authenticated) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set(
      "next",
      safeReturnTo(request.nextUrl.pathname + request.nextUrl.search),
    );
    const redirected = NextResponse.redirect(url);
    response.cookies
      .getAll()
      .forEach((cookie) => redirected.cookies.set(cookie));
    response = redirected;
  }
  // Authenticated HTML/RSC responses and refresh cookies must never enter a shared cache.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = { matcher: ["/dash/:path*", "/login"] };
