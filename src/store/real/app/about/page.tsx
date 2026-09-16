import { site } from "@/lib/products";
import { primeStoreContent } from "@/lib/content";

export const metadata = { title: "About Us — PAN Furniture" };

// Walang cache: sariwang kuha sa Supabase kada page load, kaya ang binago sa
// PAN app admin ay lumalabas agad — hindi na kailangang maghintay.
export const revalidate = 0;

export default async function AboutPage() {
  // Punan muna bago basahin ang `site` sa ibaba.
  await primeStoreContent();

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-4xl font-bold mb-10">About {site.brand.name}</h1>

      <div className="space-y-6 text-stone leading-relaxed">
        <p>
          We started as a small workshop in San Pedro, Laguna building beds for neighbours
          who could not find the right size in the mall. We still build every frame
          ourselves — kiln-dried hardwood, high-density foam, honest construction —
          and sell directly to you without showroom markups.
        </p>
        <p>
          Every piece we make is designed to be lived on. Sofas that get softer and
          more beautiful with age. Tables that survive homework, holidays, and
          everything in between. Furniture that becomes part of your family&apos;s story.
        </p>
        <p>
          That&apos;s why every frame carries a six-month warranty and our own team
          delivers and assembles it in your home. If something isn&apos;t right, message
          us and we&apos;ll make it right.
        </p>
        <p className="text-ink font-bold">
          Quality materials. Built to last. {site.brand.tagline}
        </p>
      </div>
    </div>
  );
}
