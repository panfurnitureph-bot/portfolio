import type { Metadata } from "next";
import { Inter, Cormorant } from "next/font/google";
import "./globals.css";
import { StoreProvider } from "@/components/store";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ChatBubble from "@/components/ChatBubble";
import ContentLive from "@/components/ContentLive";
import { primeStoreContent } from "@/lib/content";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const cormorant = Cormorant({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-cormorant",
});

export const metadata: Metadata = {
  title: "PAN Furnitures",
  description:
    "Premium sofas, sectionals, dining, bedroom, and outdoor furniture. Quality materials, built to last. Free shipping and a 100-day happiness guarantee.",
  // Favicon mula sa /public (static — hindi na dynamic route, iwas crash)
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Ang Header/Footer/ChatBubble ay client components — dito (sa server)
  // kinukuha ang `site` at ipinapasa bilang props, dahil sa browser ay
  // hindi tumatakbo ang primeContent().
  const { site } = await primeStoreContent();

  return (
    <html lang="en" className={`${inter.variable} ${cormorant.variable}`}>
      <body className="font-sans">
        <StoreProvider>
          {/* Nakikinig kung may binago sa PAN app admin — nagre-refresh ang
              nakabukas na page nang hindi kailangang gawin ito ng bisita. */}
          <ContentLive />
          <Header site={site} />
          <main className="min-h-screen">{children}</main>
          <Footer site={site} />
          <ChatBubble site={site} />
        </StoreProvider>
      </body>
    </html>
  );
}
