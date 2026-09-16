// ADMIN API — moderation ng pending reviews.
// approve: ililipat ang review sa tamang lugar —
//   may productSlug  → products.json (reviews ng product na yun)
//   walang productSlug → homepage.json (Google Reviews section)
// reject: buburahin lang sa pending queue.

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

const PENDING = path.join(process.cwd(), "content", "pending-reviews.json");
const PRODUCTS = path.join(process.cwd(), "content", "products.json");
const HOMEPAGE = path.join(process.cwd(), "content", "homepage.json");

function authed(req: NextRequest): boolean {
  const user = process.env.ADMIN_USERNAME || "admin";
  const pw = process.env.ADMIN_PASSWORD || "admin123";
  return (
    req.headers.get("x-admin-username") === user &&
    req.headers.get("x-admin-password") === pw
  );
}

export async function POST(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, action } = await req.json();
  if (!id || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const pending = JSON.parse(await fs.readFile(PENDING, "utf8"));
  const idx = pending.findIndex((r: any) => r.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }
  const [review] = pending.splice(idx, 1);

  if (action === "approve") {
    if (review.productSlug) {
      // → product reviews
      const products = JSON.parse(await fs.readFile(PRODUCTS, "utf8"));
      const product = products.find((p: any) => p.slug === review.productSlug);
      if (product) {
        product.reviews.unshift({
          author: review.name,
          rating: review.rating,
          text: review.text,
          date: review.date,
          verified: true,
          helpful: 0,
        });
        await fs.writeFile(PRODUCTS, JSON.stringify(products, null, 2));
      }
    } else {
      // → site-wide reviews section
      const homepage = JSON.parse(await fs.readFile(HOMEPAGE, "utf8"));
      homepage.googleReviews.items.unshift({
        name: review.name,
        rating: review.rating,
        date: review.date,
        text: review.text,
        photos: [],
        product: "",
      });
      await fs.writeFile(HOMEPAGE, JSON.stringify(homepage, null, 2));
    }
  }

  await fs.writeFile(PENDING, JSON.stringify(pending, null, 2));
  return NextResponse.json({ ok: true, remaining: pending.length });
}
