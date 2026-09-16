// ADMIN API — BUONG SET recolor (panel + kama + beddings + unan) gamit ang
// universal pipeline sa recolor-tool/. Gumagana lang kung may config na ang
// photo ng product (regions + sam_points sa recolor-tool/configs.json);
// kung wala, nagbabalik ng {error:"no_config"} para mag-fallback ang admin
// sa lumang kama-lang recolor.

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  const { slug } = await req.json();
  if (typeof slug !== "string" || !/^[\w\-]+$/.test(slug)) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }

  const root = process.cwd();
  const script = path.join(root, "recolor-tool", "recolor.py");

  const result = await new Promise<{ ok?: boolean; linked?: number; error?: string }>(
    (resolve) => {
      execFile(
        "python",
        [script, "--product", slug],
        { cwd: root, timeout: 280_000, maxBuffer: 10 * 1024 * 1024 },
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
    const status = result.error === "no_config" ? 404 : 500;
    return NextResponse.json({ error: result.error ?? "Recolor-set failed" }, { status });
  }
  return NextResponse.json(result);
}
