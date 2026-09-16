#!/usr/bin/env node
/**
 * auto-sync-reviews.js — awtomatikong kinukuha ang Google reviews at
 * ini-update ang content/homepage.json. Standalone (hindi kailangan ng
 * running server). Tinatawag ng Windows Task Scheduler kada 30 min.
 *
 * PAALALA: ang Google Places API ay 5 REVIEWS LANG ang ibinibigay (hard
 * limit ng Google). Kaya kinukuha ang pinaka-bagong 5 + rating + count.
 * Para sa LAHAT ng review, kailangan ng Google Takeout import.
 *
 * Setup (.env.local):
 *   GOOGLE_MAPS_API_KEY=...
 *   GOOGLE_PLACE_ID=...
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);
const ENV_FILE = path.join(ROOT, ".env.local");
const HOMEPAGE = path.join(ROOT, "content", "homepage.json");
const LOG = path.join(ROOT, "scripts", "auto-sync.log");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + "\n"); } catch {}
}

function loadEnv() {
  const env = {};
  try {
    for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
      const m = line.match(/^\s*([\w]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch (e) {
    log("Cannot read .env.local: " + e.message);
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const key = env.GOOGLE_MAPS_API_KEY;
  const placeId = env.GOOGLE_PLACE_ID;
  if (!key || !placeId) {
    log("MISSING GOOGLE_MAPS_API_KEY or GOOGLE_PLACE_ID — skip");
    process.exit(1);
  }

  let data;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "rating,userRatingCount,reviews.rating,reviews.text.text," +
          "reviews.relativePublishTimeDescription,reviews.authorAttribution.displayName",
      },
    });
    if (!res.ok) {
      log("Google API error " + res.status + ": " + (await res.text()).slice(0, 150));
      process.exit(1);
    }
    data = await res.json();
  } catch (e) {
    log("Fetch failed: " + e.message);
    process.exit(1);
  }

  const fetched = (data.reviews ?? []).map((r) => ({
    name: r.authorAttribution?.displayName ?? "Google user",
    rating: r.rating ?? 5,
    date: r.relativePublishTimeDescription ?? "",
    text: r.text?.text ?? "",
    photos: [],
    product: "",
  }));

  const homepage = JSON.parse(fs.readFileSync(HOMEPAGE, "utf8"));
  const existing = homepage.googleReviews.items;

  // SMARTER DEDUP — i-normalize ang name at text (alisin ang emoji, extra
  // spaces, case) para hindi maulit ang review kahit bahagyang naiiba ang
  // formatting. Susi = normalized-name + first-40-chars ng normalized-text.
  const norm = (s) =>
    String(s ?? "")
      .toLowerCase()
      .replace(/[^\w\s]/g, "")   // alisin emoji/punctuation
      .replace(/\s+/g, " ")
      .trim();
  const keyOf = (r) => norm(r.name) + "|" + norm(r.text).slice(0, 40);

  const seen = new Set(existing.map(keyOf));
  // dagdag: name-only set para ma-detect kahit bahagyang naiba ang text
  const seenNames = new Set(existing.map((r) => norm(r.name)));

  const newOnes = fetched.filter((r) => {
    if (seen.has(keyOf(r))) return false;           // exact-ish match = luma
    // parehong pangalan + parehong rating + malapit na text = luma pa rin
    const sameName = existing.find(
      (e) => norm(e.name) === norm(r.name) && e.rating === r.rating
    );
    if (sameName && norm(sameName.text).slice(0, 20) === norm(r.text).slice(0, 20)) {
      return false;
    }
    return true;
  });

  homepage.googleReviews.items = [...newOnes, ...existing];
  homepage.googleReviews.rating = data.rating ?? homepage.googleReviews.rating;
  homepage.googleReviews.count = data.userRatingCount ?? homepage.googleReviews.count;
  fs.writeFileSync(HOMEPAGE, JSON.stringify(homepage, null, 2));

  log(
    `OK — rating ${data.rating}, count ${data.userRatingCount}, ` +
    `fetched ${fetched.length}, added ${newOnes.length} bago` +
    (newOnes.length ? ": " + newOnes.map((r) => r.name).join(", ") : "")
  );

  // Count-gap check: kung mas marami ang Google count kaysa sa reviews mo,
  // may hindi makuha ng API (top-5 limit) — kailangan ng Takeout.
  const googleCount = data.userRatingCount ?? 0;
  const localCount = homepage.googleReviews.items.length;
  const gap = googleCount - localCount;
  if (gap > 0) {
    log(
      `  NOTE: ${gap} review(s) sa Google (${googleCount}) na WALA pa sa site ` +
      `(${localCount}). Ang API ay 5 lang kaya kailangan ng Google Takeout ` +
      `para makuha ang natitira.`
    );
  }

  // Auto-generate branded card para sa bawat BAGONG review (para may
  // card image agad tulad ng iba). Text-only card kung walang photo.
  if (newOnes.length > 0) {
    try {
      const { execFileSync } = require("child_process");
      execFileSync("python", [path.join(ROOT, "scripts", "make-review-cards.py")], {
        cwd: ROOT, timeout: 120000, stdio: "pipe",
      });
      log(`  -> generated review cards para sa ${newOnes.length} bagong review`);
    } catch (e) {
      log("  -> card generation failed: " + String(e.message).slice(0, 100));
    }
  }
}

main();
