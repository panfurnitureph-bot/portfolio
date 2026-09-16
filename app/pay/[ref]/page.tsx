import Link from "next/link";
import RedirectCountdown from "@/components/RedirectCountdown";

export const dynamic = "force-dynamic";

// Dito bumabalik ang customer galing sa 3DS ng Maya. Ang bayad mismo ay
// naitatala ng PAN app sa pamamagitan ng webhook — dito nagpapasalamat lang
// tayo at binubuksan ang daan pabalik sa tindahan.
export default async function PayReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { ref } = await params;
  const { status } = await searchParams;
  const orderRef = decodeURIComponent(ref);
  // status=paid galing sa matagumpay na 3DS; failed/cancelled kung hindi natuloy.
  const failed = status === "failed" || status === "cancelled";

  return (
    <div className="max-w-xl mx-auto px-6 py-20 text-center">
      {failed ? (
        <>
          <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-700 text-3xl flex items-center justify-center mx-auto mb-6">
            !
          </div>
          <h1 className="text-3xl font-bold mb-2">Payment didn&apos;t go through</h1>
          <p className="text-stone mb-1">
            Your order{" "}
            <strong className="text-cognac">{orderRef}</strong> is still
            reserved — you can try again.
          </p>
        </>
      ) : (
        <>
          <div className="w-16 h-16 rounded-full bg-green-100 text-green-700 text-3xl flex items-center justify-center mx-auto mb-6">
            ✓
          </div>
          <h1 className="text-3xl font-bold mb-2">Thank you for your payment!</h1>
          <p className="text-stone mb-1">
            We&apos;ve received the downpayment for order{" "}
            <strong className="text-cognac">{orderRef}</strong>.
          </p>
          <p className="text-sm text-stone mb-8">
            We&apos;ll email your receipt. Our team will get in touch about your
            delivery schedule.
          </p>
        </>
      )}

      {/* Kapag bayad na, ibalik siya sa home. Kapag bigo, huwag — baka gusto
          niyang subukan ulit, kaya buton lang ang ibinibigay natin. */}
      {failed ? (
        <Link
          href="/"
          className="inline-block bg-ink text-cream px-8 py-4 text-sm font-bold tracking-widest2 hover:bg-cognac transition-colors rounded"
        >
          BACK TO SHOP
        </Link>
      ) : (
        <RedirectCountdown />
      )}
    </div>
  );
}
