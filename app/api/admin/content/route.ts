// ADMIN API — reads and writes the content JSON files.
// Protected by username + password headers.
// Change credentials in .env.local:
//   ADMIN_USERNAME=yourname
//   ADMIN_PASSWORD=yoursecret

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

const FILES: Record<string, string> = {
  products: "content/products.json",
  homepage: "content/homepage.json",
  site: "content/site.json",
};

function authed(req: NextRequest): boolean {
  const user = process.env.ADMIN_USERNAME || "admin";
  const pw = process.env.ADMIN_PASSWORD || "admin123";
  return (
    req.headers.get("x-admin-username") === user &&
    req.headers.get("x-admin-password") === pw
  );
}

export async function GET(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ error: "Wrong username or password" }, { status: 401 });
  }
  const file = req.nextUrl.searchParams.get("file") ?? "";
  const rel = FILES[file];
  if (!rel) return NextResponse.json({ error: "Invalid file" }, { status: 400 });
  const full = path.join(process.cwd(), rel);
  const raw = await fs.readFile(full, "utf8");
  const stat = await fs.stat(full);
  // Version = mtime ng file — ginagamit ng admin para sa stale-write check
  return NextResponse.json(JSON.parse(raw), {
    headers: { "x-content-version": String(stat.mtimeMs) },
  });
}

export async function PUT(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ error: "Wrong username or password" }, { status: 401 });
  }
  const body = await req.json();
  const rel = FILES[body.file];
  if (!rel || body.data === undefined) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const full = path.join(process.cwd(), rel);

  // STALE-WRITE PROTECTION: kung nagbago ang file sa disk mula nang
  // i-load ng admin tab (hal. import script, sync, o ibang tab),
  // HUWAG payagan ang save — baka mapatungan ang bagong data.
  const clientVersion = req.headers.get("x-content-version");
  if (clientVersion) {
    const stat = await fs.stat(full);
    if (String(stat.mtimeMs) !== clientVersion) {
      return NextResponse.json(
        {
          error:
            "This data changed on the server since you opened the admin (a script or another tab updated it). Refresh the admin page (F5) to load the latest, then redo your edit.",
        },
        { status: 409 }
      );
    }
  }

  await fs.writeFile(full, JSON.stringify(body.data, null, 2));
  const stat = await fs.stat(full);
  return NextResponse.json(
    { ok: true },
    { headers: { "x-content-version": String(stat.mtimeMs) } }
  );
}
