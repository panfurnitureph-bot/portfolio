// ANG "NGAYON" AY SA MANILA, HINDI SA UTC.
//
// Ang `new Date().toISOString().slice(0, 10)` ay nagbibigay ng petsa sa UTC.
// Ang Pilipinas ay UTC+8, kaya sa bawat araw mula hatinggabi hanggang 8 AM ay
// KAHAPON ang isinusulat nito. Ang server ay tumatakbo sa UTC, kaya walang
// nagpapakita ng pagkakaiba hanggang may magtala ng madaling-araw.
//
// Ganito nawala ang RMA-000018 at RMA-000019: naaprubahan nang 1:51 at 1:54 AM
// ng Ago 30 sa Maynila, naitala bilang Ago 29, at ang ruta — na nagpapakita ng
// isang araw — ay nagsabing "No stops for this date" sa Ago 30. Ang biyahe ay
// nasa nakaraan bago pa ito magsimula.
//
// Ang en-CA na locale ay nagbibigay ng YYYY-MM-DD, kaya diretso itong
// naihahambing sa mga `date` na haligi.
export function todayPH(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
