// ADMIN API — gumagawa ng dimension image mula sa product photo +
// sukat (width/height/clearance). Pinapatakbo ang make-dim-photo.py.

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  const { photo, slug, width, height, clearance } = await req.json();

  if (
    typeof photo !== "string" ||
    !/^\/images\/products\/[\w\-.]+$/.test(photo) ||
    typeof slug !== "string" ||
    !/^[\w-]+$/.test(slug)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const root = process.cwd();
  // v2 = buong photo (walang cutout) para hindi maputol ang furniture
  const script = path.join(root, "scripts", "make-dim-photo2.py");
  const out = `images/dimensions/${slug}-dim-${Date.now()}.png`;

  const result = await new Promise<{ ok?: boolean; url?: string; error?: string }>(
    (resolve) => {
      execFile(
        "python",
        [
          script,
          photo.replace(/^\//, ""),
          out,
          String(width || '75.5"'),
          String(height || '40"'),
          String(clearance || '2"'),
        ],
        { cwd: root, timeout: 100_000, maxBuffer: 5 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err && !stdout) {
            resolve({ error: (stderr || err.message).slice(0, 250) });
            return;
          }
          try {
            const lines = stdout.trim().split("\n");
            resolve(JSON.parse(lines[lines.length - 1]));
          } catch {
            resolve({ error: "Parse error: " + stdout.slice(0, 150) });
          }
        }
      );
    }
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Failed" }, { status: 500 });
  }
  return NextResponse.json(result);
}
