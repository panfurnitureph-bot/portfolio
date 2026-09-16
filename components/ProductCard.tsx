"use client";

// Product card — tulad ng tunay na site: image, maliliit na variant
// swatch thumbnails sa ilalim, "Pangalan - Kulay" na title, presyo
// (may "from $X" kung may mas murang variant). Heart button sa hover.

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { formatPrice, type Product } from "@/lib/products";
import { useStore } from "@/components/store";

export default function ProductCard({
  product,
  square = false,
}: {
  product: Product;
  square?: boolean;
}) {
  const { wishlist, toggleWishlist } = useStore();
  const wished = wishlist.includes(product.slug);
  const onSale = product.compareAtPrice && product.compareAtPrice > product.price;

  // Mga color variant. Bawat swatch: bed photo (recolored .image) kung meron,
  // kung wala ay ang default na bed photo; at ang tela swatch texture para sa
  // thumbnail. Kung walang swatch, fallback sa gallery images.
  const swatches = (product.colorSwatches ?? []).filter((s) => s.image || s.swatch);
  const variants =
    swatches.length > 0
      ? swatches.map((s) => ({
          name: s.name,
          image: s.image ?? product.images[0],
          swatch: s.swatch,
        }))
      : product.images.map((img, i) => ({
          name: product.colors[i] ?? "",
          image: img,
          swatch: undefined as string | undefined,
        }));

  const [activeIdx, setActiveIdx] = useState(0);
  const active = variants[activeIdx] ?? variants[0];
  // Laging may valid na src (iwas blangkong card kapag walang image)
  const heroImage = active?.image ?? product.images[0] ?? "/images/placeholder.jpg";

  // Pangalan - kulay (nagbabago habang naka-hover sa swatch)
  const activeColor = active?.name && active.name !== "Default" ? active.name : product.colors[0];
  const title = activeColor ? `${product.name} - ${activeColor}` : product.name;

  return (
    <div className="group relative snap-start">
      {/* Heart — lumalabas sa hover (laging visible sa touch) */}
      <button
        aria-label={wished ? "Remove from wishlist" : "Add to wishlist"}
        onClick={() => toggleWishlist(product.slug)}
        className={`absolute top-3 right-3 z-10 p-1.5 rounded-full bg-cream/80 transition-opacity ${
          wished ? "opacity-100" : "opacity-0 group-hover:opacity-100 max-lg:opacity-100"
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill={wished ? "#B87333" : "none"} stroke={wished ? "#B87333" : "#1A1A1A"} strokeWidth="1.6">
          <path d="M12 21C7 16.5 3 13 3 8.8 3 6 5.2 4 7.8 4c1.7 0 3.2.9 4.2 2.3C13 4.9 14.5 4 16.2 4 18.8 4 21 6 21 8.8c0 4.2-4 7.7-9 12.2z" />
        </svg>
      </button>

      {/* Badges */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1">
        {product.isNew && (
          <span className="bg-ink text-cream text-[10px] tracking-widest2 px-2 py-1">NEW</span>
        )}
        {onSale && (
          <span className="bg-cognac text-cream text-[10px] tracking-widest2 px-2 py-1">SALE</span>
        )}
      </div>

      <Link href={`/products/${product.slug}`}>
        <div className={`relative overflow-hidden bg-[#F1EAE0] ${square ? "aspect-square" : "aspect-[4/3]"}`}>
          <Image
            src={heroImage}
            alt={product.name}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-500"
            sizes="(min-width: 1024px) 300px, 50vw"
          />
        </div>
      </Link>

      {/* Color swatch thumbnails — hover para makita ang bed sa kulay na yun.
          Ginagamit ang swatch texture (tela) kung meron; kung wala, ang
          maliit na bed photo mismo. */}
      {variants.length > 1 && (
        <div className="flex gap-1.5 mt-2">
          {variants.slice(0, 6).map((v, i) => (
            <button
              key={v.name + i}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => setActiveIdx(i)}
              title={v.name}
              aria-label={v.name || `Variant ${i + 1}`}
              className={`relative w-9 h-9 rounded bg-[#F1EAE0] overflow-hidden border-2 transition ${
                i === activeIdx ? "border-cognac" : "border-transparent hover:border-stone/40"
              }`}
            >
              <Image src={v.swatch ?? v.image} alt="" fill className="object-cover" sizes="36px" />
            </button>
          ))}
          {variants.length > 6 && (
            <span className="self-center text-[10px] text-stone">+{variants.length - 6}</span>
          )}
        </div>
      )}

      <Link href={`/products/${product.slug}`}>
        <h3 className="text-sm text-ink mt-2.5 leading-snug group-hover:text-cognac transition-colors">
          {title}
        </h3>
        <p className="text-sm mt-1.5">
          {product.priceFrom ? (
            <>
              <span className="text-stone">from </span>
              <span className="font-medium">{formatPrice(product.priceFrom)}</span>
            </>
          ) : (
            <>
              <span className={onSale ? "text-cognac font-medium" : "font-medium"}>
                {formatPrice(product.price)}
              </span>
              {onSale && (
                <span className="text-stone line-through ml-2">
                  {formatPrice(product.compareAtPrice!)}
                </span>
              )}
            </>
          )}
        </p>
      </Link>
    </div>
  );
}
