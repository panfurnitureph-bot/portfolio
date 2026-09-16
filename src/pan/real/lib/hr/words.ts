// Convert a peso amount into words for payslips/cheques.
// e.g. 640 -> "Six Hundred Forty Pesos Only"
//      1395.50 -> "One Thousand Three Hundred Ninety-Five Pesos and Fifty Centavos Only"
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES = ["", "Thousand", "Million", "Billion", "Trillion"];

function under1000(n: number): string {
  let s = "";
  if (n >= 100) { s += ONES[Math.floor(n / 100)] + " Hundred"; n %= 100; if (n) s += " "; }
  if (n >= 20) { s += TENS[Math.floor(n / 10)]; if (n % 10) s += "-" + ONES[n % 10]; }
  else if (n > 0) { s += ONES[n]; }
  return s;
}

function whole(n: number): string {
  if (n === 0) return "Zero";
  const groups: number[] = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    parts.push(under1000(groups[i]) + (SCALES[i] ? " " + SCALES[i] : ""));
  }
  return parts.join(" ");
}

export function amountInWords(amount: number): string {
  const a = Math.abs(Number(amount) || 0);
  const pesos = Math.floor(a);
  const cents = Math.round((a - pesos) * 100);
  let s = whole(pesos) + " Peso" + (pesos === 1 ? "" : "s");
  if (cents > 0) s += " and " + whole(cents) + " Centavo" + (cents === 1 ? "" : "s");
  return s + " Only";
}
