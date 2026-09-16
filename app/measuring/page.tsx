// MEASURING PAGE — /measuring
// A guide to prepare for your delivery. Layout at text ay tumutugma sa
// tunay na site: alternating na sections na may totoong illustrations,
// tapos Explore categories + pre-footer.

import Link from "next/link";
import Image from "next/image";
import { CATEGORY_TILES } from "@/lib/products";
import { primeStoreContent } from "@/lib/content";
import PreFooter from "@/components/PreFooter";

export const metadata = { title: "Measuring Your Space — PAN Furnitures" };

// Walang cache: sariwang kuha sa Supabase kada page load, kaya ang binago sa
// PAN app admin ay lumalabas agad — hindi na kailangang maghintay.
export const revalidate = 0;

const SECTIONS = [
  {
    id: "product",
    title: "Product Measurements",
    image: "/images/measuring-product.png",
    body: [
      "Make your furniture delivery seamless by ensuring it fits perfectly into your home. To help you plan ahead, our Product Description Pages include two sets of dimensions: one for the product and one for its packaging. These details make it easy to map out the delivery path and choose the ideal spot for your new piece.",
      "Read on to find out how to gather your other key measurements. Consider the full scale of your item, including the overall width (W), depth (D), and height (H).",
    ],
  },
  {
    id: "doorframes",
    title: "Doorframes",
    image: "/images/measuring-door.png",
    body: [
      "Locate the main entrance to the house or apartment. If applicable, identify any secondary entrances, like a back door or garage door.",
      "Measure the doorway’s height, width, and the diagonal distance between the door jambs.",
    ],
  },
  {
    id: "hallways",
    title: "Hallways",
    image: "/images/measuring-hallway.png",
    body: [
      "Identify any obstacles like stairs, ceiling lights, landings, or a narrow hallway leading from the doorway to the final location. Measure the height of the lowest ceiling or obstacle along the way.",
      "Measure the height, width, depth, and diagonal distance of each hallway to ensure there’s enough room to tilt or rotate the box if needed.",
    ],
  },
  {
    id: "stairs",
    title: "Stairs",
    image: "/images/measuring-stairs.png",
    body: [
      "When moving a sofa or any large item, it’s important to consider the challenges posed by stairs. Measure the narrowest point, such as the space between railings.",
      "Measure the height from both the top and bottom steps to determine the clearance for a space with low ceilings. Measure both landings’ height and width to ensure adequate space.",
      "Consider whether it might be necessary to tilt the sofa to navigate the stairway — measuring the diagonal dimension of the sofa can help determine if this approach will work.",
    ],
  },
  {
    id: "elevators",
    title: "Elevators",
    image: "/images/measuring-elevator.png",
    body: [
      "When arranging for a delivery that will require elevator access, it’s important to take a few measurements to ensure a smooth process. Measure the height and width of the door opening.",
      "Measure the interior depth of the elevator (from the door to the back wall) and its width (from one side wall to the other). This will help determine how much space is available for your items.",
      "For larger items, measure the diagonal depth — this is the distance from the bottom corner of the door to the upper back corner of the elevator.",
    ],
  },
];

export default async function MeasuringPage() {
  // Punan muna bago basahin ang `CATEGORY_TILES` sa ibaba.
  await primeStoreContent();

  return (
    <div>
      <div className="max-w-5xl mx-auto px-6 py-12">
        <h1 className="font-cormorant font-medium text-4xl sm:text-5xl text-center mb-3">
          Measuring Your Space
        </h1>
        <p className="text-stone text-center max-w-xl mx-auto mb-4">
          A guide to prepare for your delivery.
        </p>
        <p className="text-stone text-center max-w-2xl mx-auto mb-14 text-sm">
          A few minutes with a tape measure saves a delivery-day headache. Follow this guide
          to make sure your new piece fits through every point of entry.
        </p>

        <div className="divide-y divide-sand">
          {SECTIONS.map((s, i) => (
            <section
              key={s.id}
              className={`grid md:grid-cols-2 gap-10 items-center py-12 ${
                i % 2 === 1 ? "md:[direction:rtl]" : ""
              }`}
            >
              <div className="[direction:ltr] relative aspect-[4/3] bg-linen rounded overflow-hidden">
                <Image src={s.image} alt={s.title} fill className="object-contain p-4" sizes="(min-width: 768px) 500px, 100vw" />
              </div>
              <div className="[direction:ltr]">
                <h2 className="font-cormorant font-medium text-2xl sm:text-3xl mb-4">{s.title}</h2>
                {s.body.map((p) => (
                  <p key={p.slice(0, 20)} className="text-sm text-stone leading-relaxed mb-3">
                    {p}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <p className="text-center text-sm text-stone mt-10">
          Still not sure it fits? <Link href="/contact" className="underline text-ink hover:text-cognac">Contact us</Link>{" "}
          before ordering — we&apos;re happy to help you check.
        </p>
      </div>

      {/* Explore categories */}
      <section className="max-w-7xl mx-auto px-6 py-12">
        <h2 className="font-cormorant font-medium text-3xl text-center mb-8">Explore categories</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {CATEGORY_TILES.slice(0, 6).map((tile) => (
            <Link key={tile.slug} href={`/collections/${tile.slug}`} className="group text-center">
              <div className="relative aspect-square overflow-hidden bg-sand">
                <Image
                  src={`/images/category-${tile.slug}.jpg`}
                  alt={tile.label}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-500"
                  sizes="200px"
                />
              </div>
              <p className="text-sm mt-2 group-hover:text-cognac transition-colors">{tile.label}</p>
            </Link>
          ))}
        </div>
      </section>

      <PreFooter />
    </div>
  );
}
