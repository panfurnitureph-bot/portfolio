// Client-side helpers for the admin API.

export function getCreds(): { user: string; pw: string } {
  if (typeof window === "undefined") return { user: "", pw: "" };
  return {
    user: sessionStorage.getItem("pb_admin_user") ?? "",
    pw: sessionStorage.getItem("pb_admin_pw") ?? "",
  };
}

export function setCreds(user: string, pw: string) {
  sessionStorage.setItem("pb_admin_user", user);
  sessionStorage.setItem("pb_admin_pw", pw);
}

function headers() {
  const { user, pw } = getCreds();
  return {
    "x-admin-username": user,
    "x-admin-password": pw,
    "Content-Type": "application/json",
  };
}

// Bantay laban sa stale saves: tandaan ang version ng bawat file
// nang huling i-load; ipapadala sa PUT para ma-detect ng server kung
// may ibang nakapagbago na (script/ibang tab) bago tayo mag-save.
const versions: Record<string, string> = {};

export async function apiGet(file: string) {
  const res = await fetch(`/api/admin/content?file=${file}`, { headers: headers() });
  if (!res.ok) throw new Error((await res.json()).error ?? "Error");
  const v = res.headers.get("x-content-version");
  if (v) versions[file] = v;
  return res.json();
}

export async function apiPut(file: string, data: unknown) {
  const res = await fetch("/api/admin/content", {
    method: "PUT",
    headers: {
      ...headers(),
      ...(versions[file] ? { "x-content-version": versions[file] } : {}),
    },
    body: JSON.stringify({ file, data }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Error");
  const v = res.headers.get("x-content-version");
  if (v) versions[file] = v;
}

function fileToBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}

// Upload a file → returns the public URL (e.g. /images/products/x-1.jpg)
export async function apiUpload(filePath: string, file: File): Promise<string> {
  const dataBase64 = await fileToBase64(file);
  const res = await fetch("/api/admin/upload", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ filePath, dataBase64 }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Upload error");
  return (await res.json()).url;
}

// Auto-linis ng isang existing product photo -> {white, beige, closeup} URLs.
// photo = /images/products/<file> na naka-upload na.
export async function apiCleanPhoto(
  photo: string,
  slug: string,
  mode: "cutout" | "room" = "cutout"
): Promise<Record<string, string>> {
  const res = await fetch("/api/admin/clean-photo", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ photo, slug, mode }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Clean error");
  return (await res.json()).urls;
}

// Recolor ang tela ng furniture (isang photo) sa bawat swatch color.
// colors = [{name, swatch?, hex?}]. Returns [{name, hex, url}].
export async function apiRecolor(
  photo: string,
  slug: string,
  colors: { name: string; swatch?: string; hex?: string }[],
  keepBg = true,
  maskBase64?: string
): Promise<{ name: string; hex: string; url: string }[]> {
  const res = await fetch("/api/admin/recolor", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ photo, slug, colors, keepBg, maskBase64 }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Recolor error");
  return (await res.json()).variants;
}

// BUONG SET recolor (panel+kama+unan) — universal pipeline. Itinatapon ang
// {error:"no_config"} kung walang config ang photo (mag-fallback ang caller).
export async function apiRecolorSet(slug: string): Promise<{ linked: number }> {
  const res = await fetch("/api/admin/recolor-set", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ slug }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Recolor-set error");
  return res.json();
}

export function extOf(file: File): string {
  const m = file.name.match(/\.(\w+)$/);
  return (m ? m[1] : "jpg").toLowerCase();
}

export function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
