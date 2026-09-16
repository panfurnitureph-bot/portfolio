/* The storefront's client components call the Pan app's API routes (/api/send-order, /api/track,
   /api/reviews, /api/pay-card) and Maya's tokenizer. While the demo is mounted, window.fetch answers
   those itself so checkout, tracking and reviews complete without a server. Everything else passes through. */
import { products } from './real/lib/products'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let seq = 4210
function nextOrderNumber() {
  try {
    const n = Number(localStorage.getItem('store-demo-seq') || seq) + 1
    localStorage.setItem('store-demo-seq', String(n))
    seq = n
  } catch { seq += 1 }
  return `ORD-${String(seq).padStart(6, '0')}`
}

type SavedOrder = { number: string; name?: string; total?: number; amountDue?: number; date?: string; items?: { qty?: number; name?: string; description?: string; unitPrice?: number; price?: number; image?: string | null }[]; address?: string }

function savedOrders(): SavedOrder[] {
  try { return JSON.parse(localStorage.getItem('pan_orders') ?? '[]') } catch { return [] }
}

function trackResult(orderNo: string) {
  const saved = savedOrders().find((o) => o.number?.toUpperCase() === orderNo.toUpperCase())
  const placed = saved?.date ? new Date(saved.date) : new Date(Date.now() - 6 * 864e5)
  const at = (days: number) => new Date(placed.getTime() + days * 864e5).toISOString()
  const items = saved?.items?.length
    ? saved.items.map((i) => ({ qty: i.qty ?? 1, description: i.description ?? i.name ?? 'Item', unitPrice: i.unitPrice ?? i.price ?? 0, image: i.image ?? null }))
    : [{ qty: 1, description: `${products[0].name}\n• Queen`, unitPrice: products[0].price, image: products[0].images[0] }]
  const total = saved?.total ?? items.reduce((s, i) => s + i.qty * i.unitPrice, 0)
  const paid = saved?.amountDue ?? Math.round(total * 0.3)
  return {
    order_number: orderNo.toUpperCase(),
    customer_name: saved?.name ?? 'Demo Customer',
    placed_at: placed.toISOString(),
    cancelled: false,
    status: 'In production',
    stages: [
      { name: 'Order placed', done: true, current: false, at: at(0) },
      { name: 'Downpayment received', done: true, current: false, at: at(0.2) },
      { name: 'In production', done: false, current: true, at: at(1) },
      { name: 'Quality check', done: false, current: false, at: null },
      { name: 'Out for delivery', done: false, current: false, at: null },
      { name: 'Delivered', done: false, current: false, at: null },
    ],
    items,
    total,
    paid,
    balance: Math.max(0, total - paid),
    address: saved?.address ?? 'Santa Rosa, Laguna',
    scheduled_for: null,
    shipping_fee: 0,
    delivery_confirmed: false,
    lead_weeks: [3, 5],
  }
}

let orig: typeof window.fetch = (...a) => window.fetch(...a)

async function handle(url: string, init?: RequestInit): Promise<Response | null> {
  const u = new URL(url, location.origin)
  const path = u.pathname
  const method = (init?.method ?? 'GET').toUpperCase()
  const body = () => { try { return JSON.parse(String(init?.body ?? '{}')) } catch { return {} } }

  if (path === '/api/send-order' && method === 'POST') {
    const b = body() as { total?: number; order_ref?: string; payment_method?: string }
    const number = nextOrderNumber()
    const amountDue = Math.round(Number(b.total ?? 0) * 0.3)
    await new Promise((r) => setTimeout(r, 600))
    return json({ ok: true, order_number: number, amount_due: amountDue, qr_payload: `00020101021228DEMO${number}5303608540${amountDue}5802PH5914PAN FURNITURES6006LUCENA6304DEMO` })
  }
  if (path === '/api/track') {
    const order = (u.searchParams.get('order') ?? '').trim()
    const verify = (u.searchParams.get('verify') ?? '').trim()
    await new Promise((r) => setTimeout(r, 500))
    if (!/^ORD-\d{4,}$/i.test(order)) return json({ error: 'We couldn\'t find that order. Try ORD-004211 with any email.' }, 404)
    if (!verify) return json({ error: 'Enter the email or the last 4 digits of the phone used on the order.' }, 400)
    return json(trackResult(order))
  }
  if (path === '/api/reviews' && method === 'POST') {
    await new Promise((r) => setTimeout(r, 400))
    return json({ ok: true, pending: true })
  }
  if (path === '/api/pay-card' && method === 'POST') {
    await new Promise((r) => setTimeout(r, 900))
    return json({ ok: true, is_paid: true })
  }
  if (path === '/api/send-mto' && method === 'POST') {
    await new Promise((r) => setTimeout(r, 700))
    return json({ ok: true, mto_number: `MTO-${String(Date.now()).slice(-6)}` })
  }
  if (path === '/api/places') {
    // address autocomplete is a server-side Google/Photon proxy in production; the demo has no suggestions
    return json({ suggestions: [] })
  }
  if (path === '/barangays.json') {
    return orig('/store/barangays.json', init)
  }
  if (/paymaya\.com$/.test(u.hostname) && path.endsWith('/payments/v1/payment-tokens')) {
    await new Promise((r) => setTimeout(r, 500))
    return json({ paymentTokenId: 'demo-token-' + Date.now(), state: 'AVAILABLE' })
  }
  return null
}

/** Patches window.fetch for the demo; returns the restore function. */
export function installApiMock(): () => void {
  const real = window.fetch.bind(window)
  orig = real
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const mocked = await handle(url, init).catch(() => null)
    return mocked ?? real(input, init)
  }) as typeof window.fetch
  return () => { window.fetch = real }
}
