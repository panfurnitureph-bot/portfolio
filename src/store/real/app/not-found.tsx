import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-24 text-center">
      <h1 className="text-5xl font-bold mb-4">404</h1>
      <p className="text-stone mb-8">We couldn't find that page.</p>
      <Link
        href="/"
        className="inline-block bg-ink text-cream px-8 py-4 text-sm font-bold tracking-widest2 hover:bg-cognac transition-colors"
      >
        BACK TO HOMEPAGE
      </Link>
    </div>
  );
}
