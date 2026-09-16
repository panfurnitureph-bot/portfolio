export const metadata = { title: "Shipping & Returns — PAN Furniture" };

export default function ShippingPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-4xl font-bold mb-10">Shipping & Returns</h1>

      <div className="space-y-10 text-stone leading-relaxed">
        <section>
          <h2 className="text-xl font-bold text-ink mb-3">Delivery Across Luzon</h2>
          <p>
            Delivery is quoted per city at checkout. Laguna, Cavite, Batangas, Rizal and
            Metro Manila are delivered by our own trucks; farther provinces go
            through partner couriers. Made-to-order pieces are finished within 3–5 weeks.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink mb-3">Assembly Included</h2>
          <p>
            Our delivery team carries the piece to your room of choice, assembles it,
            and takes the packaging away.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink mb-3">6-Month Warranty</h2>
          <p>
            Every frame is covered for six months against structural defects. Message us
            with a photo and we&apos;ll schedule a repair — on us.
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
