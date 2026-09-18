/**
 * Genera los iconos PNG (PWA, Apple, Open Graph) a partir de public/img/logo.svg.
 * Uso: npm run icons
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imgDir = path.join(root, 'public', 'img');
const logo = fs.readFileSync(path.join(imgDir, 'logo.svg'));

const siteName = process.env.SITE_NAME || 'Vereda de los Estudiantes';
const brand = process.env.SITE_BRAND || 'Foro Vecinal';

async function main() {
  for (const size of [192, 512, 180]) {
    const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
    await sharp(logo, { density: 400 }).resize(size, size).png().toFile(path.join(imgDir, name));
  }

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b3d33"/><stop offset="1" stop-color="#13715d"/></linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#g)"/>
    <circle cx="1050" cy="80" r="260" fill="#23a385" fill-opacity="0.25"/>
    <text x="80" y="290" font-family="Segoe UI, Arial, sans-serif" font-size="30" font-weight="700" fill="#bfe7d9" letter-spacing="4">${esc(brand.toUpperCase())} · LEGANÉS</text>
    <text x="80" y="370" font-family="Segoe UI, Arial, sans-serif" font-size="66" font-weight="800" fill="#ffffff">${esc(siteName)}</text>
    <text x="80" y="440" font-family="Segoe UI, Arial, sans-serif" font-size="32" fill="#ffffff" fill-opacity="0.85">Lo que pasa en el barrio, contado por sus vecinos.</text>
  </svg>`;
  const logoPng = await sharp(logo, { density: 400 }).resize(120, 120).png().toBuffer();
  await sharp(Buffer.from(og))
    .composite([{ input: logoPng, top: 120, left: 80 }])
    .png()
    .toFile(path.join(imgDir, 'og-default.png'));

  /* Iconos "maskable": Android los recorta en círculo, rombo o gota según el
     móvil. El dibujo tiene que caber en el 80 % central y el resto ha de ser
     fondo liso, o el logo aparece mordido. */
  for (const size of [192, 512]) {
    const interior = Math.round(size * 0.56);
    const hueco = Math.round((size - interior) / 2);
    const marca = await sharp(logo, { density: 400 }).resize(interior, interior).png().toBuffer();
    await sharp({ create: { width: size, height: size, channels: 4, background: '#0f5c4c' } })
      .composite([{ input: marca, top: hueco, left: hueco }])
      .png()
      .toFile(path.join(imgDir, `icon-maskable-${size}.png`));
  }

  /* Iconos de los accesos directos (mantener pulsado sobre la app instalada). */
  const atajos = {
    'atajo-publicar': '<path d="M5 12h14"/><path d="M12 5v14"/>',
    'atajo-mapa': '<path d="m9 3-6 2v16l6-2 6 2 6-2V3l-6 2z"/><path d="M9 3v16M15 5v16"/>',
    'atajo-negocios':
      '<path d="M3 9h18l-1.5-5h-15L3 9Z"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/>',
  };
  for (const [nombre, cuerpo] of Object.entries(atajos)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="5" fill="#0f5c4c"/>
      <g fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
         transform="translate(4.8 4.8) scale(0.6)">${cuerpo}</g>
    </svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(imgDir, `${nombre}.png`));
  }

  console.log('Iconos generados en public/img');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
