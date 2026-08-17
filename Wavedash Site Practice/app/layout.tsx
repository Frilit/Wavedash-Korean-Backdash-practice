import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const title = "Tekken Movement Trainer — Wavedash & KBD Practice";
  const description = "Practice Korean backdash and Mishima-style wavedash timing with safe, browser-observed keyboard and gamepad input.";
  const socialImage = new URL("/thumbnail.jpg", base).toString();
  return {
    metadataBase: base,
    title,
    description,
    icons: { icon: "/thumbnail.jpg" },
    openGraph: { title, description, type: "website", url: base, images: [{ url: socialImage, width: 611, height: 500, alt: "Absolute Dorya" }] },
    twitter: { card: "summary_large_image", title, description, images: [socialImage] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
