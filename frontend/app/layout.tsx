import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Newsreader } from "next/font/google";
import "./globals.css";

const eventName = process.env.NEXT_PUBLIC_EVENT_NAME?.trim() || "<eventname>";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";
const previewImage = process.env.NEXT_PUBLIC_EVENT_PREVIEW_IMAGE?.trim() || "/event-preview.svg";
const description = `View your photos from ${eventName} wedding`;

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  style: ["normal", "italic"],
  variable: "--font-family-serif",
});

const geistSans = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "ShareMemories",
  description,
  openGraph: {
    title: "ShareMemories",
    description,
    type: "website",
    images: [
      {
        url: previewImage,
        alt: `${eventName} wedding preview`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ShareMemories",
    description,
    images: [previewImage],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
