// PUBLIC REVIEWS API
// POST — kahit sinong customer pwedeng mag-submit ng review mula sa
//        website. Papasok muna sa content/pending-reviews.json
//        (pending) hanggang i-approve mo sa admin.
// GET  — (admin lang) listahan ng pending reviews.

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

const PENDING = path.join(process.cwd(), "content", "pending-reviews.json");

function authed(req: NextRequest): boolean {
  const user = process.env.ADMIN_USERNAME || "admin";
  const pw = process.env.ADMIN_PASSWORD || "admin123";
  return (
    req.headers.get("x-admin-username") === user &&
    req.headers.get("x-admin-password") === pw
  );
}

async function readPending() {
  try {
    return JSON.parse(await fs.readFile(PENDING, "utf8"));
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Honeypot: ang "website" field ay tago sa form — tao hindi
  // magfi-fill; bots lang. Kapag may laman, itapon nang tahimik.
  if (body.website) return NextResponse.json({ ok: true });

  const name = String(body.name ?? "").trim().slice(0, 60);
  const text = String(body.text ?? "").trim().slice(0, 2000);
  const rating = Math.min(5, Math.max(1, Number(body.rating) || 5));
  const productSlug = String(body.productSlug ?? "").slice(0, 100);

  if (!name || text.length < 5) {
    return NextResponse.json(
      { error: "Please fill in your name and review." },
      { status: 400 }
    );
  }

  const pending = await readPending();

  // Simpleng spam guard: max 200 pending
  if (pending.length >= 200) {
    return NextResponse.json({ error: "Review queue is full." }, { status: 429 });
  }

  pending.unshift({
    id: "rev_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    productSlug,
    name,
    rating,
    text,
    date: new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    submittedAt: new Date().toISOString(),
  });

  await fs.writeFile(PENDING, JSON.stringify(pending, null, 2));
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await readPending());
}
