export const metadata = { title: "Privacy Policy — PAN Furniture" };

// Public Privacy Policy — kailangan din ng Meta App Review (Privacy Policy URL)
// para sa Messenger app, at ng mga customer ng site.

const SECTIONS: { h: string; body: string[] }[] = [
  {
    h: "Information we collect",
    body: [
      "Orders and deliveries. When you place an order we collect your name, contact number, email address, delivery address, and the details of the items you purchase, so we can process, deliver, and install your order and issue official receipts.",
      "Messenger conversations. When you message our Facebook Page, we receive your public profile name, profile photo, and the messages you send. We use this to respond to your inquiries — including automated replies for common questions — and to link your conversation to your order when you contact us about one. A human team member can take over the conversation at any time.",
      "Payments. Card and e-wallet payments are processed by our payment providers (such as Maya). We do not store your card numbers or wallet credentials; we receive only payment confirmations and reference numbers needed for your receipt.",
    ],
  },
  {
    h: "How we use information",
    body: [
      "We use your information to process and deliver orders, provide warranty service, respond to inquiries, send order-related notifications (order confirmation, delivery schedule, payment receipts), and improve our products and service. We do not sell your personal information.",
    ],
  },
  {
    h: "Sharing",
    body: [
      "We share information only with service providers who help us operate — payment processors, delivery logistics, cloud hosting, and messaging platforms (Meta, for Facebook Messenger) — and only to the extent needed to provide the service. These providers are bound by their own privacy obligations.",
    ],
  },
  {
    h: "Retention and security",
    body: [
      "We keep order records for as long as required for warranty, accounting, and legal obligations under Philippine law. Access to customer data inside our systems is role-restricted and logged.",
    ],
  },
  {
    h: "Your choices",
    body: [
      "You may stop receiving Messenger messages from us at any time by using Facebook's message controls or telling us to stop. You may request a copy, correction, or deletion of your personal data by contacting us — subject to records we are legally required to keep.",
    ],
  },
  {
    h: "Contact us",
    body: [
      "PAN Furniture · Philippines",
      "Email: panfurnitureph@gmail.com",
      "Facebook: facebook.com/panfurnitureph",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-stone text-sm mb-10">Last updated: August 4, 2026</p>

      <p className="text-stone text-sm leading-relaxed mb-8">
        PAN Furniture (&quot;we&quot;, &quot;our&quot;, &quot;us&quot;) operates this website, our order and
        delivery systems, and the PAN Furniture Facebook Page and Messenger experience. This policy
        explains what information we collect, how we use it, and the choices you have.
      </p>

      <div className="space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.h}>
            <h2 className="text-xl font-bold mb-3">{s.h}</h2>
            {s.body.map((p, i) => (
              <p key={i} className="text-stone text-sm leading-relaxed mb-3">{p}</p>
            ))}
          </section>
        ))}
      </div>

      <p className="text-stone text-xs mt-12 pt-6 border-t border-sand">
        We may update this policy from time to time; the latest version will always be available on
        this page.
      </p>
    </div>
  );
}
