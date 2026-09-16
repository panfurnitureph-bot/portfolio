// ADMIN API — auto-linis ng ISANG product photo.
// Tumatawag sa scripts/clean-photo.py -> white bg, beige bg, headboard closeup.
// Ginagamit sa Products tab pagkatapos mag-upload ng raw photo.

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
  const { photo, slug, mode } = await req.json();
  const cleanMode = mode === "room" ? "room" : "cutout";

  // photo = /images/products/<file> na existing na (naka-upload na)
  if (
    typeof photo !== "string" ||
    !/^\/images\/products\/[\w\-.]+\.(jpg|jpeg|png|webp)$/i.test(photo) ||
    typeof slug !== "string" ||
    !/^[\w\-]+$/.test(slug)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const root = process.cwd();
  const script = path.join(root, "scripts", "clean-photo.py");
  const inputAbs = path.join(root, "public", photo.replace(/^\//, ""));
  const outDir = path.join(root, "public", "images", "products");

  const result = await new Promise<{ ok?: boolean; urls?: Record<string, string>; error?: string }>(
    (resolve) => {
      execFile(
        "python",
        [script, inputAbs, outDir, slug, cleanMode],
        { cwd: root, timeout: 55_000, maxBuffer: 5 * 1024 * 1024 },
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
    return NextResponse.json({ error: result.error ?? "Clean failed" }, { status: 500 });
  }
  return NextResponse.json(result);
}
