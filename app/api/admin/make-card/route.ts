// ADMIN API — auto-generate ng branded review card para sa ISANG
// review photo (tinatawag pagkatapos mag-upload sa admin).
// Pinapatakbo ang scripts/make-review-cards.py sa --single mode.

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const { photo, name, rating, text } = await req.json();

  if (
    typeof photo !== "string" ||
    !/^\/images\/reviews\/[\w\-.]+$/.test(photo) ||
    typeof name !== "string" ||
    !name.trim() ||
    typeof text !== "string"
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const root = process.cwd();
  const script = path.join(root, "scripts", "make-review-cards.py");
  const photoAbs = path.join(root, "public", photo.replace(/^\//, ""));

  const result = await new Promise<{ ok?: boolean; url?: string; error?: string }>(
    (resolve) => {
      execFile(
        "python",
        [script, "--single", photoAbs, name, String(rating ?? 5), text || " "],
        { cwd: root, timeout: 45_000, maxBuffer: 5 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err && !stdout) {
            resolve({ error: (stderr || err.message).slice(0, 250) });
            return;
          }
          try {
            const lines = stdout.trim().split("\n");
            resolve(JSON.parse(lines[lines.length - 1]));
          } catch {
            resolve({ error: "Could not parse output: " + stdout.slice(0, 150) });
          }
        }
      );
    }
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Card failed" }, { status: 500 });
  }
  return NextResponse.json(result);
}
