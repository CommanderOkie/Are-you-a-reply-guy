import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Are You a Reply Guy / Gal? 💀",
  description:
    "Enter your Twitter/X handle and get an Intensity Audit of your replying habits. Find out who you glaze, your reply velocity, and your Reply Guy Persona.",
  openGraph: {
    title: "Are You a Reply Guy / Gal? 💀",
    description:
      "Get your Reply Intensity Audit — who do you glaze? What's your persona?",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Are You a Reply Guy / Gal? 💀",
    description:
      "Get your Reply Intensity Audit — find out your persona and who you can't stop replying to.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
