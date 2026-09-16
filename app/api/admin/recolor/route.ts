// ADMIN API — recolor ang tela ng furniture sa isang photo papunta sa
// kulay ng bawat color swatch. Isang photo -> maraming kulay (parang P&B).
// Tumatawag sa scripts/recolor-fabric.py.

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import fs from "fs/promises";
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

type Spec = { name: string; swatch?: string; hex?: string };

export async function POST(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ error: "Wrong username or password" }, { status: 401 });
  }
  const { photo, slug, colors, keepBg, maskBase64 } = await req.json();
  let bgmode = keepBg === false ? "white" : "keepbg";

  if (
    typeof photo !== "string" ||
    !/^\/images\/products\/[\w\-.]+\.(jpg|jpeg|png|webp)$/i.test(photo) ||
    typeof slug !== "string" ||
    !/^[\w\-]+$/.test(slug) ||
    !Array.isArray(colors) ||
    colors.length === 0 ||
    colors.length > 30
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const root = process.cwd();
  const script = path.join(root, "scripts", "recolor-fabric.py");
  const inputAbs = path.join(root, "public", photo.replace(/^\//, ""));
  const outDir = path.join(root, "public", "images", "products");

  // Buuin ang specs: "name|swatch|<abs>"  o  "name|hex|#rrggbb"
  const specs: string[] = [];
  for (const c of colors as Spec[]) {
    const name = (c.name || "color").replace(/[|]/g, " ").slice(0, 60);
    if (c.swatch && /^\/images\/swatches\/[\w\-./]+\.(jpg|jpeg|png|webp)$/i.test(c.swatch)) {
      const abs = path.join(root, "public", c.swatch.replace(/^\//, ""));
      specs.push(`${name}|swatch|${abs}`);
    } else if (c.hex && /^#?[0-9a-fA-F]{6}$/.test(c.hex)) {
      specs.push(`${name}|hex|${c.hex.replace(/^#?/, "#")}`);
    }
  }
  if (!specs.length) {
    return NextResponse.json({ error: "No valid colors (need swatch image or hex)" }, { status: 400 });
  }

  // Kung may user-drawn mask (brush), i-save at gamitin ito imbes na rembg
  if (typeof maskBase64 === "string" && maskBase64.length > 100) {
    const maskPath = path.join(outDir, `${slug}-brushmask.png`);
    try {
      await fs.writeFile(maskPath, Buffer.from(maskBase64, "base64"));
      bgmode = "mask:" + maskPath;
    } catch {
      // kung sablay ang save, bumalik sa keepbg
    }
  }

  const result = await new Promise<{ ok?: boolean; variants?: unknown; error?: string }>(
    (resolve) => {
      execFile(
        "python",
        [script, inputAbs, outDir, slug, bgmode, ...specs],
        { cwd: root, timeout: 110_000, maxBuffer: 10 * 1024 * 1024 },
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
    return NextResponse.json({ error: result.error ?? "Recolor failed" }, { status: 500 });
  }
  return NextResponse.json(result);
}
