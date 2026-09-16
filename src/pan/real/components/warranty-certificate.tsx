// Read-only PRODUCT WARRANTY CERTIFICATE preview (no signing / saving).
// Used by the Warranty Documents page; mirrors the installation form layout.

export type CertItem = {
  description: string | null;
  image_url: string | null;
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  // Buong SPECIFICATION / DESIGN DETAILS (isang spec kada linya).
  specs: string | null;
  qty: number;
  customized?: boolean;
};

export type CertData = {
  warrantyNo: string;
  dateIssued: string;
  branch: string;
  salesRep: string;
  customerName: string;
  contact: string;
  email: string;
  address: string;
  invoice: string;
  datePurchase: string;
  dateDelivered: string;
  mop: string;
  driver: string;
  installer: string;
  coordinator: string;
  items: CertItem[];
  warrantyDuration: string;
  validUntil: string;
  signatureUrl: string | null;
};

function Heading({ t }: { t: string }) {
  return <p className="mt-4 mb-1 border-b border-stone-400 pb-0.5 text-xs font-bold tracking-wide" style={{ color: "#5C4632" }}>{t}</p>;
}
function Field({ label, v }: { label: string; v: string }) {
  return <p><span className="text-stone-500">{label}:</span> <b>{v}</b></p>;
}

export function WarrantyCertificate({ d }: { d: CertData }) {
  // WALANG COLOR NA HANAY KUNG WALANG KULAY (hiling 2026-08-29). Ang lapad ay
  // naka-pin sa 794px — A4 — kaya ang 80px na hanay na puro "—" ay puwang na
  // ninanakaw sa SPECIFICATION, na siyang laging masikip. Kapag walang alinman
  // sa mga item ang may kulay, tinatanggal ang hanay at napupunta ang puwang
  // sa spec (`<col />` na walang lapad ang kumukuha ng natitira).
  //
  // Isang item lang ang may kulay → nananatili ang hanay: mas mabuting may
  // "—" kaysa mawala ang kulay ng dalawa sa tatlong produkto.
  const hasColor = d.items.some((x) => !!(x.color ?? "").trim());
  return (
    <div className="warranty-doc w-full rounded-xl bg-white p-10 text-[13px] leading-relaxed text-stone-800" style={{ color: "#3a2e20" }}>
      {/* Header */}
      <div className="text-center" style={{ color: "#5C4632" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Pan Furniture" className="mx-auto h-20 w-20 object-contain" />
        <p className="mt-1 text-xl font-bold tracking-wide">PRODUCT WARRANTY CERTIFICATE</p>
      </div>
      <p className="mt-1 text-center text-[11px] text-stone-500">Please keep this certificate together with your official receipt. It is required for all warranty claims.</p>

      <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 border-y border-stone-300 py-2">
        <Field label="Warranty No." v={d.warrantyNo} />
        <Field label="Date Issued" v={d.dateIssued || "—"} />
        <Field label="Branch / Store" v={d.branch} />
        <Field label="Sales Rep" v={d.salesRep || "—"} />
      </div>

      <Heading t="CUSTOMER INFORMATION" />
      <div className="grid grid-cols-2 gap-x-8 gap-y-1">
        <Field label="Customer Name" v={d.customerName || "—"} />
        <Field label="Contact Number" v={d.contact || "—"} />
        <Field label="Email Address" v={d.email || "—"} />
        <Field label="Delivery Address" v={d.address || "—"} />
      </div>

      <Heading t="PURCHASE INFORMATION" />
      <div className="grid grid-cols-2 gap-x-8 gap-y-1">
        <Field label="Invoice / OR No." v={d.invoice || "—"} />
        <Field label="Date of Purchase" v={d.datePurchase || "—"} />
        <Field label="Date Delivered" v={d.dateDelivered || "—"} />
        <Field label="Mode of Payment" v={d.mop || "—"} />
        <Field label="Coordinator" v={d.coordinator || "—"} />
        <Field label="Driver" v={d.driver || "—"} />
        <Field label="Installer" v={d.installer || "—"} />
      </div>

      <Heading t="PRODUCT DETAILS COVERED" />
      <table className="w-full border-collapse text-[11px] [&_td]:border [&_td]:border-stone-400 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-stone-400 [&_th]:bg-stone-100 [&_th]:px-2 [&_th]:py-1">
        {/* TIYAK NA LAPAD KADA HANAY (2026-08-25). Ang nakukuhang kopya ay naka-pin
            sa 794px — lapad ng A4 — kaya ~714px lang ang natitira sa anim na hanay.
            Pinabayaan itong hatiin ng browser noon: naipit ang litrato sa 36px at
            bumagsak sa dalawang linya ang bawat spec. Ang litrato at ang spec ang
            binibigyan ng puwang; ang CATEGORY/COLOR/QTY ay maiikling salita. */}
        <colgroup>
          <col style={{ width: "208px" }} />
          <col style={{ width: "96px" }} />
          <col style={{ width: "76px" }} />
          {hasColor && <col style={{ width: "80px" }} />}
          <col />
          <col style={{ width: "38px" }} />
        </colgroup>
        {/* SPECIFICATION / DESIGN DETAILS, hindi DIMENSION (2026-08-25) — ang
            dimension ay isang bullet lang sa labing-isa ng custom na kama. */}
        <thead><tr><th>PHOTO</th><th>PRODUCT NAME</th><th>CATEGORY</th>{hasColor && <th>COLOR</th>}<th className="text-left">SPECIFICATION / DESIGN DETAILS</th><th>QTY</th></tr></thead>
        <tbody>{d.items.map((x, i) => (
          <tr key={i}><td className="text-center align-middle">{x.image_url ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={x.image_url} alt="" className="mx-auto h-28 w-28 rounded border border-gray-200 bg-white object-contain p-1" /> : "—"}</td><td className="text-center align-middle whitespace-pre-line">{x.customized && <span className="mb-0.5 mx-auto block w-fit rounded bg-amber-100 px-1 text-[9px] font-bold uppercase tracking-wide text-amber-700">Customized</span>}{x.description}</td><td className="text-center align-middle">{x.category || "—"}</td>{hasColor && <td className="text-center align-middle">{x.color || "—"}</td>}{/* NAKA-CENTER ANG BLOKE (hiling 2026-08-29). Naka-center ang buong
              talahanayan; ito lang ang nakadikit sa kaliwa, kaya mukhang bitin.
              Ang mga bullet ay magkahanay pa rin sa isa't isa — nakasentro ang
              LISTAHAN, hindi ang bawat linya, kung hindi ay ngangalit ang tuldok. */}
            <td className="text-center align-middle">{x.specs
            ? <ul className="mx-auto w-fit list-disc space-y-0.5 pl-4 text-left">{x.specs.split("\n").filter(Boolean).map((ln, k) => <li key={k}>{ln}</li>)}</ul>
            : (x.dimension || "—")}</td><td className="text-center align-middle">{x.qty}</td></tr>
        ))}</tbody>
      </table>

      <Heading t="WARRANTY COVERAGE" />
      <p><b>Warranty Period:</b> {d.warrantyDuration} from the Date of Purchase — <b>six (6) months for promo items</b> and <b>one (1) year for customized items</b>, unless otherwise stated. <span className="text-stone-500">(Valid until {d.validUntil || "—"})</span></p>
      <p className="mt-1">The woodwork of the furniture is covered. Within the warranty period, the following are addressed and resolved <b>free of charge</b>, provided the item is used under normal conditions and proper care &amp; maintenance is followed:</p>
      <ul className="ml-5 list-disc">
        <li>Manufacturing defects in materials and woodwork.</li>
        <li>Structural defects of frames and joints under normal household use.</li>
        <li>Defective mechanisms such as swivel plates, hinges, and other moving hardware.</li>
        <li>Premature peeling or detachment of surface finish not caused by misuse.</li>
      </ul>
      <p className="mt-1">Warranty covers complimentary repairs for the designated furniture item. <b>Pickup and delivery costs</b> for warranty service are shouldered by the client.</p>

      <Heading t="WHAT IS NOT COVERED" />
      <ul className="ml-5 list-disc">
        <li>Normal wear and tear, fading, or natural variation in wood, fabric, and ceramic.</li>
        <li>Damage from misuse, accidents, abuse, or improper cleaning and maintenance.</li>
        <li>Damage caused by exposure to moisture, direct sunlight, heat, pests, or flooding.</li>
        <li>Damage from improper assembly, alteration, or repair by unauthorized persons.</li>
        <li>Products used for commercial, rental, or non-household purposes (unless agreed in writing).</li>
        <li>Items with removed, altered, or unreadable SKU/serial labels and no proof of purchase.</li>
      </ul>

      <Heading t="HOW TO FILE A WARRANTY CLAIM" />
      <ol className="ml-5 list-decimal">
        <li>Contact the store where the item was purchased within the warranty period.</li>
        <li>Present this Warranty Certificate together with the original official receipt.</li>
        <li>Provide clear photos or allow inspection of the defective item.</li>
        <li>Upon validation, the company will repair, replace, or service the item at its discretion.</li>
      </ol>

      <Heading t="TERMS & CONDITIONS" />
      <ol className="ml-5 list-decimal">
        <li>This warranty is valid only for the original purchaser and is non-transferable.</li>
        <li>Repair or replacement does not extend the original warranty period.</li>
        <li>Delivery or transport costs for warranty service may be shouldered by the customer.</li>
        <li>The company&rsquo;s decision on all warranty claims is final, subject to applicable law.</li>
      </ol>

      <Heading t="ACKNOWLEDGEMENT" />
      <p>I confirm that I received the above item(s) in good condition and that I have read and understood the terms of this warranty.</p>
      <div className="mt-6 grid grid-cols-2 gap-10">
        <div className="text-center">
          {d.signatureUrl
            ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={d.signatureUrl} alt="signature" className="mx-auto h-16 w-full object-contain" />
            : <div className="h-16" />}
          <p className="mt-1 border-t border-stone-500 pt-1 text-[11px]">Customer<br />Signature over Printed Name / Date</p>
        </div>
        <div className="text-center">
          <div className="h-16" />
          <p className="mt-1 border-t border-stone-500 pt-1 text-[11px]">Authorized Company Representative<br />Signature over Printed Name / Date</p>
        </div>
      </div>
    </div>
  );
}
