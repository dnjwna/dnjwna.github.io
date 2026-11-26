# Receipt Portfolio · Danu Trisna Juwana

Portfolio bergaya struk thermal printer. Hero-nya printer 3D (Three.js) yang mencetak struk; scroll = nge-feed kertas.

## Jalankan

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # hasil di dist/
npm run preview
```

## Struktur

| File | Isi |
| --- | --- |
| `index.html` | Semua konten (navbar, menu, hero, struk) |
| `src/style.css` | Token warna/tipografi, navbar, menu, struk, print stylesheet |
| `src/scene.js` | Printer 3D + kertas yang di-deform per frame (path naik → melengkung ke belakang → jatuh ke meja) |
| `src/receiptTexture.js` | Isi struk yang dicetak printer 3D (canvas texture) |
| `src/nav.js` | Navbar: ink bar aktif, tape "now printing", jam Bandung, sembunyi saat scroll turun, menu yang di-print & disobek, shortcut 1–5 |
| `src/sound.js` | Suara printer sintetis (default off) |
| `src/barcode.js` | Barcode dekoratif (bukan barcode yang bisa di-scan) |

## Ganti konten

- Proyek / log / kontak: edit langsung di `index.html`.
- Isi struk di printer 3D: array `items` dan teks di `src/receiptTexture.js`.
- Jumlah feed saat scroll: tinggi `.hero` (`230svh`) di `style.css`.
- Warna: variabel `:root` di `style.css`.

Font (Doto + Martian Mono) di-self-host lewat `@fontsource`, jadi tidak perlu Google Fonts.

## Deploy

Live: https://dnjwna.github.io

Setiap push ke `main` otomatis di-build dan dideploy oleh `.github/workflows/deploy.yml` (GitHub Actions → GitHub Pages).
Sekali saja: di repo, **Settings → Pages → Build and deployment → Source: GitHub Actions**.

`public/og.jpg` adalah gambar preview saat link dibagikan (LinkedIn, WhatsApp, X).
