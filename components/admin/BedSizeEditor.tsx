"use client";

// Bed size editor — bawat size (Single–King 2): sukat (A/B/C/D/E) +
// presyo + on/off. Ito ang lalabas sa product page: size selector,
// FRAME DIMENSIONS table, at presyo per size.

type BedSize = {
  size: string;
  dim: string;
  A: string;
  B: string;
  C: string;
  D: string;
  E: string;
  price?: number;
  enabled?: boolean;
};

const DEFAULTS: BedSize[] = [
  { size: "Single", dim: '36"x75"', A: '40"', B: '48"', C: '81"', D: '12"', E: '4"', enabled: true },
  { size: "Twin", dim: '48"x75"', A: '52"', B: '48"', C: '81"', D: '12"', E: '4"', enabled: true },
  { size: "Double/Full", dim: '54"x75"', A: '58"', B: '48"', C: '81"', D: '12"', E: '4"', enabled: true },
  { size: "Queen", dim: '60"x75"', A: '64"', B: '48"', C: '81"', D: '12"', E: '4"', enabled: true },
  { size: "King", dim: '72"x75"', A: '76"', B: '48"', C: '81"', D: '12"', E: '4"', enabled: true },
  { size: "King 2", dim: '72"x78"', A: '76"', B: '48"', C: '84"', D: '12"', E: '4"', enabled: true },
];

export default function BedSizeEditor({
  value,
  basePrice,
  onChange,
  category,
}: {
  value?: BedSize[];
  basePrice: number;
  onChange: (rows: BedSize[]) => void;
  // Ang mattress ay walang frame — sukat at presyo lang ang kailangan nito,
  // kaya itinatago ang A/B/C/D/E kapag mattress ang product.
  category?: string;
}) {
  const isMattress = category === "mattress";
  const rows: BedSize[] = value && value.length ? value : DEFAULTS.map((d) => ({ ...d, price: basePrice }));

  function update(i: number, patch: Partial<BedSize>) {
    onChange(rows.map((r, x) => (x === i ? { ...r, ...patch } : r)));
  }

  const cell = "border border-stone/30 bg-white px-1.5 py-1 text-xs rounded focus:outline-none focus:border-cognac w-full";

  return (
    <div>
      <p className="text-xs font-bold text-stone mb-1">
        📐 {isMattress ? "Mattress sizes" : "Bed sizes"} — dimensions + price per size (this is
        what shows on the product page)
      </p>
      <p className="text-[11px] text-stone mb-3">
        Uncheck any size that isn&apos;t available. The price adjusts when the customer picks a size.
        {isMattress && ' Enter the full dimensions including thickness, e.g. 6 x 36 x 75".'}
      </p>
      <div className="overflow-x-auto">
        <table className={`text-xs border-collapse ${isMattress ? "min-w-[380px]" : "min-w-[640px]"}`}>
          <thead>
            <tr className="text-left text-stone">
              <th className="p-1 font-bold">On</th>
              <th className="p-1 font-bold">Size</th>
              <th className="p-1 font-bold">{isMattress ? "Dimensions" : "Mattress"}</th>
              {/* Frame lang — walang A/B/C/D/E ang mattress mismo. */}
              {!isMattress && (
                <>
                  <th className="p-1 font-bold">A Width</th>
                  <th className="p-1 font-bold">B Hdbrd</th>
                  <th className="p-1 font-bold">C Length</th>
                  <th className="p-1 font-bold">D Base</th>
                  <th className="p-1 font-bold">E Legs</th>
                </>
              )}
              <th className="p-1 font-bold">Price ₱</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.size} className={r.enabled === false ? "opacity-40" : ""}>
                <td className="p-1 text-center">
                  <input
                    type="checkbox"
                    checked={r.enabled !== false}
                    onChange={(e) => update(i, { enabled: e.target.checked })}
                    className="accent-cognac"
                  />
                </td>
                <td className="p-1 font-bold whitespace-nowrap">{r.size}</td>
                <td className="p-1">
                  <input
                    value={r.dim}
                    onChange={(e) => update(i, { dim: e.target.value })}
                    placeholder={isMattress ? '6 x 36 x 75"' : undefined}
                    className={cell + (isMattress ? " w-28" : " w-20")}
                  />
                </td>
                {!isMattress && (
                  <>
                    <td className="p-1"><input value={r.A} onChange={(e) => update(i, { A: e.target.value })} className={cell + " w-14"} /></td>
                    <td className="p-1"><input value={r.B} onChange={(e) => update(i, { B: e.target.value })} className={cell + " w-14"} /></td>
                    <td className="p-1"><input value={r.C} onChange={(e) => update(i, { C: e.target.value })} className={cell + " w-14"} /></td>
                    <td className="p-1"><input value={r.D} onChange={(e) => update(i, { D: e.target.value })} className={cell + " w-14"} /></td>
                    <td className="p-1"><input value={r.E} onChange={(e) => update(i, { E: e.target.value })} className={cell + " w-14"} /></td>
                  </>
                )}
                <td className="p-1">
                  <input
                    type="number"
                    value={r.price ?? basePrice}
                    onChange={(e) => update(i, { price: Number(e.target.value) || 0 })}
                    className={cell + " w-20"}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
