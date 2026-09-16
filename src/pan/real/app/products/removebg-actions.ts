"use server";

import { requireEdit } from "@/lib/auth/guard";

// HD background removal via a SELF-HOSTED rembg service (open-source, U2Net/BiRefNet).
// No API key, no per-image limit, fully local/private, free. Used as the "make it
// pure" fallback when the free in-browser model leaves a messy cutout.
//
// Run the service (see docs/rembg-setup.md):
//   pip install "rembg[cli]"
//   rembg s --host 0.0.0.0 --port 7000        # HTTP server on :7000
// Then set REMBG_URL in the env (defaults to http://localhost:7000).
//
// Returns a transparent PNG (base64 data URL) so the client composites it on white
// and uploads like any capture. If the service is unreachable we return a clear
// error — the free on-device path still works.
const REMBG_URL = process.env.REMBG_URL || "http://localhost:7000";

export async function removeBgHd(
  formData: FormData,
): Promise<{ png: string } | { error: string }> {
  await requireEdit("/products", "products");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No image to clean." };
  if (file.size > 12 * 1024 * 1024) return { error: "Image too large for HD cleanup (max 12 MB)." };

  // rembg HTTP API: POST /api/remove (multipart file) → PNG bytes.
  const out = new FormData();
  out.append("file", file, "capture.jpg");

  let res: Response;
  try {
    res = await fetch(`${REMBG_URL.replace(/\/$/, "")}/api/remove`, {
      method: "POST",
      body: out,
    });
  } catch (e) {
    return { error: `HD cleanup service unreachable at ${REMBG_URL}. Is rembg running? (${(e as Error)?.message ?? e})` };
  }

  if (!res.ok) {
    return { error: `rembg error ${res.status}: ${(await res.text().catch(() => "")) || res.statusText}` };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return { png: `data:image/png;base64,${buf.toString("base64")}` };
}
