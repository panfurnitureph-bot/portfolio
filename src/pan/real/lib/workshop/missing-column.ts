// Ang mensahe ng Postgres/PostgREST kapag WALA PA ang isang column:
//   column "used_by" of relation "workshop_stock_log" does not exist
//   Could not find the 'used_by' column of 'workshop_stock_log' in the schema cache
//
// Ginagamit ito para MABUHAY ang isang insert bago tumakbo ang migration —
// subukan na may bagong column, at kapag ito ang reklamo, ulitin nang wala.
// Ang pangalan ng column ang tinitingnan, hindi ang eksaktong parirala: iyon
// ang nagbabago kada bersyon ng PostgREST.
export function isMissingColumn(message: string | null | undefined, column: string): boolean {
  const m = String(message ?? "");
  if (!m.includes(column)) return false;
  return /does not exist|could not find|schema cache/i.test(m);
}
