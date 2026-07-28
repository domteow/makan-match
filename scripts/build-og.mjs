// Rasterise scripts/og.svg -> public/og.png at exactly 1200x630, the size
// every unfurler (WhatsApp, Telegram, Slack, Twitter) crops from.
//
// Run with: npm run build:og
//
// The brand fonts come from @fontsource so the card matches the app instead of
// whatever the build machine happens to have installed. Two consequences:
//
//   * resvg's font database only reads sfnt (ttf/otf), and fontsource ships
//     woff2 — so the faces are decompressed to ttf in a temp dir first.
//   * loadSystemFonts is off, so there is no fallback face to quietly
//     substitute. Text either sets in the intended typeface or does not
//     render at all, which is the failure mode we can actually detect.
//
// Both are asserted below: the PNG must be 1200x630, and every <text> in the
// SVG must have resolved to glyph outlines.

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { decompress } from "wawoff2";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every family/weight combination og.svg asks for. A missing one shows up as
// missing text, which the glyph assertion below catches.
const FONT_FILES = [
  "@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2",
  "@fontsource/public-sans/files/public-sans-latin-700-normal.woff2",
  "@fontsource/public-sans/files/public-sans-latin-800-normal.woff2",
];

async function loadFonts() {
  const dir = await mkdtemp(join(tmpdir(), "makanmatch-og-"));
  const files = [];
  for (const [i, pkgPath] of FONT_FILES.entries()) {
    const woff2 = await readFile(join(root, "node_modules", pkgPath));
    const ttf = join(dir, `${i}.ttf`);
    await writeFile(ttf, Buffer.from(await decompress(woff2)));
    files.push(ttf);
  }
  return files;
}

// Width and height sit at a fixed offset in the IHDR chunk, always the first
// chunk of a PNG. Cheaper than an image library for the one property that has
// to be exact.
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const countPaths = (usvg) => (usvg.match(/<path\b/g) || []).length;

const svg = await readFile(join(root, "scripts", "og.svg"), "utf8");
const fontFiles = await loadFonts();

// usvg flattens laid-out text into glyph outlines. Resolving the same SVG with
// no fonts at all gives the shapes-only baseline; the difference is the text
// that actually set. Anything less than one path per <text> means a family or
// weight is missing from FONT_FILES.
//
// This baseline is built first on purpose: resvg's logger is process-global and
// takes the level of whichever instance is constructed first, and this render
// is *meant* to have no fonts, so its "no match for font-family" warnings would
// only be noise. The assertion below, not the log, is what guards the fonts.
const textNodes = (svg.match(/<text\b/g) || []).length;
const shapesOnly = new Resvg(svg, {
  font: { fontFiles: [], loadSystemFonts: false },
  logLevel: "error",
}).toString();

const resvg = new Resvg(svg, {
  font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Public Sans" },
});
const glyphPaths = countPaths(resvg.toString()) - countPaths(shapesOnly);
if (glyphPaths < textNodes) {
  throw new Error(
    `Fonts did not resolve: ${textNodes} text nodes produced ${glyphPaths} glyph paths`
  );
}

const png = resvg.render().asPng();
const { width, height } = pngSize(png);
if (width !== 1200 || height !== 630) {
  throw new Error(`Expected 1200x630, got ${width}x${height}`);
}

await mkdir(join(root, "public"), { recursive: true });
await writeFile(join(root, "public", "og.png"), png);
console.log(
  `public/og.png — ${width}x${height}, ${(png.length / 1024).toFixed(0)}KB, ` +
    `${textNodes} text nodes set in ${glyphPaths} glyph paths`
);
