// Decorative barcode: deterministic bar/space widths derived from a string.
// Not a scannable symbology; it only needs to look like the bottom of a receipt.

/** @returns {{ w: number, bar: boolean }[]} */
export function barcodeBars(str) {
  const out = [];
  const quiet = () => out.push({ w: 4, bar: false });
  const guard = () => out.push({ w: 1, bar: true }, { w: 1, bar: false }, { w: 1, bar: true });

  quiet();
  guard();
  let h = 2166136261 >>> 0;
  for (const ch of String(str)) {
    // FNV-1a step per character, then spend the hash bits on 4 bar/space pairs
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
    let bits = h;
    for (let k = 0; k < 4; k++) {
      out.push({ w: 1 + (bits & 3) % 3, bar: true });
      bits >>>= 2;
      out.push({ w: 1 + (bits & 1), bar: false });
      bits >>>= 1;
    }
  }
  guard();
  quiet();
  return out;
}

export function renderBarcodes(root = document) {
  const NS = 'http://www.w3.org/2000/svg';
  root.querySelectorAll('svg[data-barcode]').forEach((svg) => {
    const bars = barcodeBars(svg.dataset.barcode);
    const total = bars.reduce((s, b) => s + b.w, 0);
    svg.setAttribute('viewBox', `0 0 ${total} 10`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.replaceChildren();
    let x = 0;
    for (const b of bars) {
      if (b.bar) {
        const r = document.createElementNS(NS, 'rect');
        r.setAttribute('x', x);
        r.setAttribute('y', 0);
        r.setAttribute('width', b.w);
        r.setAttribute('height', 10);
        r.setAttribute('fill', 'currentColor');
        svg.appendChild(r);
      }
      x += b.w;
    }
  });
}
