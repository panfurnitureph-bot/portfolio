export const metadata = { title: "FAQs — PAN Furniture" };

const FAQS = [
  {
    q: "How long does a made-to-order piece take?",
    a: "Most bed frames and sofas are finished within 3–5 weeks. We send photos from the workshop on Messenger as your order progresses.",
  },
  {
    q: "How much is delivery?",
    a: "Delivery is quoted per city at checkout. San Pedro and nearby provinces are delivered by our own trucks; farther areas go through partner couriers.",
  },
  {
    q: "How do I pay?",
    a: "A 30% downpayment via QR Ph or card confirms the order. The balance is settled before delivery.",
  },
  {
    q: "Can I order fabric or leather swatches?",
    a: "Absolutely. Message us and we'll send swatch photos of any material, or mail a physical swatch, so you can see it before you buy.",
  },
  {
    q: "How do I care for full-grain leather?",
    a: "Wipe with a clean, dry cloth and condition every 6–12 months. Keep out of direct sunlight. Scratches buff out with gentle rubbing — that's the beauty of full-grain.",
  },
  {
    q: "Is your furniture pet-friendly?",
    a: "Many of our pieces use performance fabrics designed to resist claws, fur, and stains. Look for the pet-friendly note in product descriptions.",
  },
  {
    q: "What does the warranty cover?",
    a: "Frame, foam and workmanship are covered for six months. Fabric wear and tear is not covered.",
  },
  {
    q: "What if my item arrives damaged?",
    a: "Take photos and contact us within 48 hours — we'll arrange a free replacement or repair immediately.",
  },
];

export default function FaqsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-4xl font-bold mb-10">Frequently Asked Questions</h1>
      <div className="space-y-4">
        {FAQS.map((f) => (
          <details key={f.q} className="group border border-sand bg-white p-5">
            <summary className="font-bold cursor-pointer list-none flex justify-between items-center">
              {f.q}
              <span className="text-cognac group-open:rotate-45 transition-transform text-xl">+</span>
            </summary>
            <p className="text-stone text-sm mt-3 leading-relaxed">{f.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
