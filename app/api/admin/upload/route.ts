// ADMIN API — image/video upload (base64) into /public.
// Protected by the same username + password.

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
  const { filePath, dataBase64 } = await req.json();

  // Safe paths only: images/... or videos/..., no ".."
  if (
    typeof filePath !== "string" ||
    !/^(images|videos)\/[\w\-./]+$/.test(filePath) ||
    filePath.includes("..")
  ) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const dest = path.join(process.cwd(), "public", filePath);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(dataBase64, "base64"));
  return NextResponse.json({ ok: true, url: "/" + filePath.replace(/\\/g, "/") });
}

export async function DELETE(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ error: "Wrong username or password" }, { status: 401 });
  }
  const { filePath } = await req.json();
  if (
    typeof filePath !== "string" ||
    !/^(images|videos)\/[\w\-./]+$/.test(filePath) ||
    filePath.includes("..")
  ) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  try {
    await fs.unlink(path.join(process.cwd(), "public", filePath));
  } catch {
    // wala na ang file — ok lang
  }
  return NextResponse.json({ ok: true });
}
