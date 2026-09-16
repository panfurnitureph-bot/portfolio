// ADMIN API — SYNC FROM GOOGLE
// Kinukuha ang totoong rating, bilang ng reviews, at reviews ng
// PAN Furniture mula sa Google Places API, tapos isinusulat sa
// content/homepage.json → googleReviews.
//
// Kailangan sa .env.local:
//   GOOGLE_MAPS_API_KEY=...
//   GOOGLE_PLACE_ID=...

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

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
    return NextResponse.json({ error: "Wrong username or password" }, { status: 401 });
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID;
  if (!key || !placeId) {
    return NextResponse.json(
      { error: "Missing GOOGLE_MAPS_API_KEY or GOOGLE_PLACE_ID in .env.local" },
      { status: 500 }
    );
  }

  // Kunin mula sa Google Places API (New)
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "rating,userRatingCount,reviews.rating,reviews.text.text,reviews.relativePublishTimeDescription,reviews.authorAttribution.displayName",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const msg = await res.text();
    return NextResponse.json(
      { error: "Google API error: " + msg.slice(0, 200) },
      { status: 502 }
    );
  }
  const data = await res.json();

  const fetched = (data.reviews ?? []).map((r: any) => ({
    name: r.authorAttribution?.displayName ?? "Google user",
    rating: r.rating ?? 5,
    date: r.relativePublishTimeDescription ?? "",
    text: r.text?.text ?? "",
    photos: [],
    product: "",
  }));

  // MERGE — hindi pinapalitan ang buong listahan:
  // pinapanatili ang lahat ng existing (kasama photos/cards nila),
  // idinadagdag lang sa unahan ang mga BAGONG review na wala pa.
  const file = path.join(process.cwd(), "content", "homepage.json");
  const homepage = JSON.parse(await fs.readFile(file, "utf8"));
  const existing = homepage.googleReviews.items as any[];
  const seen = new Set(
    existing.map((r) => r.name + "|" + String(r.text ?? "").slice(0, 80))
  );
  const newOnes = fetched.filter(
    (r: any) => !seen.has(r.name + "|" + String(r.text).slice(0, 80))
  );
  homepage.googleReviews.items = [...newOnes, ...existing];
  homepage.googleReviews.rating = data.rating ?? homepage.googleReviews.rating;
  homepage.googleReviews.count = data.userRatingCount ?? homepage.googleReviews.count;
  await fs.writeFile(file, JSON.stringify(homepage, null, 2));

  return NextResponse.json({
    ok: true,
    rating: data.rating,
    count: data.userRatingCount,
    fetched: fetched.length,
    added: newOnes.length,
  });
}
