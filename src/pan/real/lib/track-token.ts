import { createHmac } from "crypto";

// Isang lagdang token para sa isang order number — kaya buksan agad ang tracker
// nang hindi na hinihingi ang email/telepono. Ipinapadala ito sa staff/customer
// sa loob ng "Track order" na link ng FB alert. Hindi ito mahuhulaan (HMAC ng
// order number gamit ang lihim ng server), kaya ligtas kahit direktang buksan;
// walang token = verify pa rin, kaya ang plain na order number lang ay walang
// naipapakita.
const TRACK_SECRET = process.env.WEBSITE_ORDER_SECRET || process.env.MAYA_WEBHOOK_SECRET || "";

export function trackToken(orderNumber: string): string {
  if (!TRACK_SECRET) return "";
  return createHmac("sha256", TRACK_SECRET).update(orderNumber).digest("hex").slice(0, 24);
}
