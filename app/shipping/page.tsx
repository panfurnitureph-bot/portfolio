export const metadata = { title: "Shipping & Returns — PAN Furnitures" };

export default function ShippingPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-4xl font-bold mb-10">Shipping & Returns</h1>

      <div className="space-y-10 text-stone leading-relaxed">
        <section>
          <h2 className="text-xl font-bold text-ink mb-3">Free Shipping, Always</h2>
          <p>
            Every order ships free — no minimums, no surprises at checkout. In-stock
            items leave our warehouse within 3–5 business days and typically arrive
            within 1–2 weeks.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink mb-3">White-Glove Delivery</h2>
          <p>
            Upgrade at checkout and our team will deliver to your room of choice,
            assemble your furniture, and haul away all packaging.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink mb-3">100-Day Happiness Guarantee</h2>
          <p>
            Live with your new furniture for up to 100 days. Not in love? We&apos;ll
            schedule a free pickup and refund you in full — no restocking fees, no
            fine print.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink mb-3">Damaged or Defective Items</h2>
          <p>
            Inspect your delivery and report any damage within 48 hours with photos.
            We&apos;ll send a replacement or arrange a repair right away, on us.
          </p>
        </section>
      </div>
    </div>
  );
}
