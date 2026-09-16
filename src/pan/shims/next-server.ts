/* next/server shim — only the surface server actions touch (NextResponse.json / redirect). */
export class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...(init?.headers as Record<string, string> | undefined) } }) }
  static redirect(url: string | URL, status = 307) { return new NextResponse(null, { status, headers: { location: String(url) } }) }
  static next() { return new NextResponse(null) }
}
export type NextRequest = Request & { nextUrl: URL }
export const after = (fn: () => unknown) => { void Promise.resolve().then(fn) }
