import qrcode from 'qrcode-generator';

/* A real, scannable QR code drawn like thermal dots.
   Data modules are slightly inset squares (reads as dot-matrix); the three
   finder patterns stay solid, because that's what scanners lock onto. */

export const VCARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Juwana;Danu Trisna;;;',
  'FN:Danu Trisna Juwana',
  'EMAIL:danujuwana05@gmail.com',
  'URL:https://github.com/dnjwna',
  'URL:https://linkedin.com/in/dnjwna',
  'END:VCARD',
].join('\r\n');

export function renderQR(svg, text = VCARD, { quiet = 4, dot = 0.9 } = {}) {
  // level L: a screen can't get creased or torn, so fewer, larger modules scan better
  const qr = qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + quiet * 2;
  const inFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

  const inset = (1 - dot) / 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      const x = c + quiet;
      const y = r + quiet;
      if (inFinder(r, c)) d += `M${x} ${y}h1v1h-1z`;
      else d += `M${x + inset} ${y + inset}h${dot}v${dot}h-${dot}z`;
    }
  }
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  // no background rect: printed straight onto the paper (already light enough for a quiet zone)
  svg.innerHTML = `<path d="${d}" fill="#1E1F23"/>`;
  return n;
}
