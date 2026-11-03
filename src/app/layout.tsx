import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppThemeProvider } from "@/components/auth/theme-provider";
import "./globals.css";
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
export const metadata: Metadata = {
  title: { default: "Folio — Your lead workspace", template: "%s · Folio" },
  description:
    "A private workspace for lead management, calling history, scheduled follow-ups and CSV imports.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className={`${geist.variable} ${mono.variable}`}>
        <AppThemeProvider>{children}</AppThemeProvider>
      </body>
    </html>
  );
}
