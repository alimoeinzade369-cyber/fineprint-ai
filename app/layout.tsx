import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "FinePrint AI — Understand before you sign", description: "AI-powered document and contract risk analysis." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}