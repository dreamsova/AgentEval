import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";

import "./globals.css";

const body = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-body"
});

export const metadata: Metadata = {
  title: "AgentEval",
  description: "Behavioral reliability evaluation for AI agents."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={body.variable}>
        {children}
      </body>
    </html>
  );
}
