import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WAR ROOM — Geopolitical Risk Terminal",
  description: "AI-powered geopolitical scenario analysis for Nifty options traders. Bayesian probability engine with auditable math.",
  keywords: "nifty, options, geopolitical risk, iran war, oil price, india vix, bayesian",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
