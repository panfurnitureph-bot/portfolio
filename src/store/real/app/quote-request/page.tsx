// QUOTE REQUEST PAGE — /quote-request
//
// Ang listahan ng mga made-to-order build na hinihingan ng presyo. Dating
// nakaupo ito sa loob ng product page sa pagitan ng mga opsyon at ng mga
// buton, kaya lumalaki ito sa bawat pagdagdag at itinutulak ang mga buton
// paibaba habang binubuo pa ng customer ang produkto. Dito, may puwang para
// sa BAWAT LINYA ng bawat build — ito ang tinitingnan ng customer para
// matiyak na tama ang pagkakabuo bago ipadala.
//
// Kapareho ng cart: server wrapper na kumukuha ng content, client component
// na humahawak ng listahan mula sa localStorage.

import { site } from "@/lib/products";
import { primeStoreContent } from "@/lib/content";
import QuoteRequestClient from "./quote-request-client";

export const revalidate = 0;

export const metadata = { title: "Your quote request — PAN Furniture" };

export default async function QuoteRequestPage() {
  // Punan muna bago basahin ang `site` sa ibaba — doon nakatira ang shipping
  // rates at ang Messenger handle.
  await primeStoreContent();
  return <QuoteRequestClient site={site} />;
}
