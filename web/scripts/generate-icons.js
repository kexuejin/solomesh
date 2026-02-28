#!/usr/bin/env node
import { existsSync, writeFileSync } from 'fs';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, '..', 'public', 'icons');
const faviconSvgPath = join(__dirname, '..', 'public', 'favicon.svg');
const logo1024Path = join(publicDir, 'logo-1024.png');

const sizes = [48, 72, 96, 128, 144, 152, 192, 384, 512];
const FAVICON_SIZE = 128;
const MASKABLE_BG_MAX_DELTA = 24;
const MASKABLE_BG_START = 232;
const MASKABLE_BG_END = 252;

function removeNearWhiteBackground(buffer, channels) {
  if (channels < 4) return buffer;
  const next = Buffer.from(buffer);
  for (let idx = 0; idx < next.length; idx += channels) {
    const r = next[idx];
    const g = next[idx + 1];
    const b = next[idx + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    if (delta > MASKABLE_BG_MAX_DELTA || max < MASKABLE_BG_START) continue;

    const ratio = Math.min(1, Math.max(0, (max - MASKABLE_BG_START) / (MASKABLE_BG_END - MASKABLE_BG_START)));
    next[idx + 3] = Math.round(next[idx + 3] * (1 - ratio));
  }
  return next;
}

async function generateFaviconSvg(sourcePath) {
  const pngBuffer = await sharp(sourcePath)
    .resize(FAVICON_SIZE, FAVICON_SIZE, { fit: 'cover' })
    .png()
    .toBuffer();
  const base64Png = pngBuffer.toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FAVICON_SIZE} ${FAVICON_SIZE}">\n  <image width="${FAVICON_SIZE}" height="${FAVICON_SIZE}" href="data:image/png;base64,${base64Png}" />\n</svg>\n`;
  writeFileSync(faviconSvgPath, svg, 'utf8');
  console.log(`✓ Generated ${faviconSvgPath}`);
}

async function generateIcons() {
  const sourcePath = existsSync(logo1024Path) ? logo1024Path : faviconSvgPath;

  console.log(`Using source: ${sourcePath}`);

  // Generate standard icons
  for (const size of sizes) {
    const pngPath = join(publicDir, `icon-${size}.png`);
    console.log(`Generating ${pngPath}...`);

    await sharp(sourcePath)
      .resize(size, size)
      .png()
      .toFile(pngPath);

    console.log(`✓ Generated ${pngPath}`);
  }

  // Generate maskable icon (512x512 with 20% padding)
  const maskablePath = join(publicDir, 'icon-512-maskable.png');
  console.log(`Generating ${maskablePath}...`);

  const innerSize = Math.floor(512 * 0.6); // 60% of 512
  const padding = Math.floor((512 - innerSize) / 2);

  const { data: resizedData, info: resizedInfo } = await sharp(sourcePath)
    .resize(innerSize, innerSize)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const maskableBuffer = await sharp(
    removeNearWhiteBackground(resizedData, resizedInfo.channels),
    {
      raw: {
        width: resizedInfo.width,
        height: resizedInfo.height,
        channels: resizedInfo.channels,
      },
    },
  )
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: maskableBuffer, top: padding, left: padding }])
    .png()
    .toFile(maskablePath);

  console.log(`✓ Generated ${maskablePath}`);

  // Generate Apple Touch Icon (180x180)
  const appleTouchIconPath = join(publicDir, 'apple-touch-icon-180.png');
  console.log(`Generating ${appleTouchIconPath}...`);

  await sharp(sourcePath)
    .resize(180, 180)
    .png()
    .toFile(appleTouchIconPath);

  console.log(`✓ Generated ${appleTouchIconPath}`);
  await generateFaviconSvg(sourcePath);

  console.log('\n✅ All icons generated successfully!');
}

generateIcons().catch((error) => {
  console.error('❌ Error generating icons:', error);
  process.exit(1);
});
