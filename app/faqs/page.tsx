export const metadata = { title: "FAQs — PAN Furnitures" };

const FAQS = [
  {
    q: "How long does shipping take?",
    a: "In-stock items ship within 3–5 business days and arrive within 1–2 weeks. Every order ships free — no minimum.",
  },
  {
    q: "What is the 100-Day Happiness Guarantee?",
    a: "Live with your furniture for up to 100 days. If you're not in love, we'll pick it up for free and refund you in full.",
  },
  {
    q: "Do you offer financing?",
    a: "Yes — 0% APR financing is available for 12 and 24 months through our checkout partners.",
  },
  {
    q: "Can I order fabric or leather swatches?",
    a: "Absolutely. Contact us and we'll mail free swatches of any material so you can see and feel it before you buy.",
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
    q: "How does the rewards program work?",
    a: "Earn points on every purchase, review, and referral. Points convert to discounts on future orders.",
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
