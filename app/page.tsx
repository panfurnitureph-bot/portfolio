// HOMEPAGE — eksaktong section order ng polyandbark.com:
// 1 Hero slideshow (sale GIF + 3 slides)   2 Trust badges (icons)
// 3 Shop by category (carousel)            4 Featured in (dark olive)
// 5 Best-selling sofas (carousel)          6 Banner: Audrey collection
// 7 Split: Outdoor                         8 Testimonials
// 9 Split: Statement armchairs            10 Banner: Bedroom
// 11 Split: The dining edit               12 Video reviews
// 13 UGC grid                             14 FAQs
// 15 Google reviews                       16 Pre-footer contact
// Ang laman ay ini-edit sa PAN app (Website → Hero / Banners / Reviews) at
// nakaimbak sa Supabase; ang content/homepage.json ang fallback.

import Image from "next/image";
import Link from "next/link";
import {
  homepage,
  products,
  CATEGORY_TILES,
  categoryTileImage,
  findManyByPrefix,
} from "@/lib/products";
import { primeStoreContent } from "@/lib/content";
import HeroSlideshow from "@/components/HeroSlideshow";
import TrustBadges from "@/components/TrustBadges";
import Carousel from "@/components/Carousel";
import PressBar from "@/components/PressBar";
import ProductCard from "@/components/ProductCard";
import BannerSlideshow from "@/components/BannerSlideshow";
import SplitSection from "@/components/SplitSection";
import Testimonials from "@/components/Testimonials";
import VideoReviews from "@/components/VideoReviews";
import UgcGrid from "@/components/UgcGrid";
import FaqAccordion from "@/components/FaqAccordion";
import GoogleReviews from "@/components/GoogleReviews";
import PreFooter from "@/components/PreFooter";
import ScrollTop from "@/components/ScrollTop";

// Walang cache: sariwang kuha sa Supabase kada page load, kaya ang binago sa
// PAN app admin ay lumalabas agad — hindi na kailangang maghintay.
export const revalidate = 0;

export default async function HomePage() {
  // Punan muna bago basahin ang `homepage` sa ibaba.
  await primeStoreContent();

  const bestSelling = findManyByPrefix(homepage.bestSelling.productPrefixes);
  const [audreyBanner, bedroomBanner] = homepage.bannerSlideshows;
  const [outdoorSplit, armchairSplit, diningSplit] = homepage.splitSections;

  return (
    <div>
      {/* 1 — HERO SLIDESHOW */}
      <HeroSlideshow slides={homepage.heroSlides} />

      {/* 2 — TRUST BADGES */}
      <TrustBadges badges={homepage.trustBadges} />

      {/* 3 — SHOP BY CATEGORY (carousel na may arrows) */}
      <Carousel title="Shop by category">
        {CATEGORY_TILES.map((tile) => (
          <Link
            key={tile.slug}
            href={`/collections/${tile.slug}`}
            className="group snap-start shrink-0 w-[44vw] sm:w-[265px] text-center"
          >
            <div className="relative aspect-[4/5] overflow-hidden bg-sand">
              <Image
                src={categoryTileImage(tile.slug)}
                alt={tile.label}
                fill
                className="object-cover group-hover:scale-105 transition-transform duration-500"
                sizes="240px"
              />
            </div>
            <p className="text-sm mt-3 group-hover:text-cognac transition-colors">
              {tile.label}
            </p>
          </Link>
        ))}
      </Carousel>

      {/* 4 — FEATURED IN (dark olive + quote + logos) */}
      <PressBar pressBar={homepage.pressBar} />

      {/* 5 — BEST-SELLING SOFAS */}
      <Carousel title={homepage.bestSelling.title}>
        {bestSelling.map((p) => (
          <div key={p.slug} className="snap-start shrink-0 w-[70vw] sm:w-[280px]">
            <ProductCard product={p} />
          </div>
        ))}
      </Carousel>

      {/* 6 — BANNER SLIDESHOW: AUDREY */}
      <BannerSlideshow slides={audreyBanner.slides} />

      {/* 7 — SPLIT: OUTDOOR */}
      <SplitSection
        {...outdoorSplit}
        products={findManyByPrefix(outdoorSplit.productPrefixes)}
      />

      {/* 8 — TESTIMONIALS */}
      <Testimonials testimonials={homepage.testimonials} />

      {/* 9 — SPLIT: STATEMENT ARMCHAIRS */}
      <SplitSection
        {...armchairSplit}
        products={findManyByPrefix(armchairSplit.productPrefixes)}
      />

      {/* 10 — BANNER SLIDESHOW: BEDROOM */}
      <BannerSlideshow slides={bedroomBanner.slides} />

      {/* 11 — SPLIT: THE DINING EDIT */}
      <SplitSection
        {...diningSplit}
        products={findManyByPrefix(diningSplit.productPrefixes)}
      />

      {/* 12 — VIDEO REVIEWS */}
      <VideoReviews videoReviews={homepage.videoReviews} />

      {/* 13 — UGC GRID */}
      <UgcGrid ugc={homepage.ugc} products={products} />

      {/* 14 — FAQS */}
      <FaqAccordion />

      {/* 15 — GOOGLE REVIEWS */}
      <GoogleReviews googleReviews={homepage.googleReviews} products={products} />

      {/* 16 — PRE-FOOTER CONTACT */}
      <PreFooter />

      <ScrollTop />
    </div>
  );
}
