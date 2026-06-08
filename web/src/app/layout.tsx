import type { Metadata } from "next";
import { DM_Mono, Fraunces, Instrument_Sans } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["300", "500", "700"],
  display: "swap",
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "PromptForge — Automated Prompt Optimizer",
  description:
    "Meta-prompting + LLM-as-judge: iteratively rewrite a prompt and watch its score climb.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${dmMono.variable} ${instrumentSans.variable} h-full`}
    >
      <body className="min-h-full font-sans antialiased bg-paper text-ink">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
