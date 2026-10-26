/*
 * Community photo pipeline: validation, automated quality checks, perceptual
 * fingerprints for duplicate detection, and the web copies players see.
 *
 * Hard limits reject an upload outright; quality checks only raise flags for a
 * moderator, because a hard car can be a good round. Every copy served to
 * players is re-encoded without metadata (location, camera, software).
 */
const crypto = require('crypto');
const sharp = require('sharp');

const LIMITS = {
  maxBytes: 15 * 1024 * 1024,
  minLong: 1200,                 // pixels on the long side
  minShort: 700,
  maxPixels: 80e6,
  formats: ['jpeg', 'png', 'webp'],
};
const SIZES = { large: 1600, medium: 960, small: 480 };

// AI-generation markers that appear in EXIF/XMP: IPTC's digital source type,
// C2PA manifests, and the names of common generators.
const AI_MARKERS = /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|c2pa|Midjourney|DALL[·-]?E|Stable Diffusion|Adobe Firefly|Imagen|AI generated|generative fill/i;

// 64-bit difference hash: 9x8 greyscale, each bit = is this pixel brighter than its right neighbour.
async function dhash(input) {
  const { data } = await sharp(input).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += data[y * 9 + x] > data[y * 9 + x + 1] ? '1' : '0';
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}
// Focus measure: variance of the Laplacian on a 640px greyscale copy. Sharp
// photos score well above 50 at that size; out-of-focus ones fall under ~12.
async function focus(input) {
  const { data, info } = await sharp(input).rotate().greyscale().resize(640, 640, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = (y * W + x) * C;
      const v = data[i - W * C] + data[i + W * C] + data[i - C] + data[i + C] - 4 * data[i];
      sum += v; sum2 += v * v; n++;
    }
  }
  return n ? sum2 / n - (sum / n) ** 2 : 0;
}
// Bits that differ between two 64-bit hashes (as 16 hex digits).
function hamming(a, b) {
  if (!a || !b || a.length !== 16 || b.length !== 16) return 64;
  const pop = x => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
  return pop((parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16)) >>> 0) + pop((parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16)) >>> 0);
}

// Hashes of the whole frame and of likely crops of it: the centre at 85% and
// 70%, and each corner at 85%. A cropped copy's whole frame then lines up
// with one of the original's crops (and the reverse).
const CROPS = { c85: [0.85, 0.5, 0.5], c70: [0.7, 0.5, 0.5], tl: [0.85, 0, 0], tr: [0.85, 1, 0], bl: [0.85, 0, 1], br: [0.85, 1, 1] };
async function fingerprints(upright, width, height) {
  const out = { full: await dhash(upright) };
  for (const [name, [scale, ax, ay]] of Object.entries(CROPS)) {
    const w = Math.round(width * scale), h = Math.round(height * scale);
    const left = Math.round((width - w) * ax), top = Math.round((height - h) * ay);
    out[name] = await dhash(await sharp(upright).extract({ left, top, width: w, height: h }).toBuffer());
  }
  return out;
}
// Fingerprints of any photo file, from a small upright copy (hashing only needs 9x8 pixels).
async function printsOf(buf) {
  const upright = await sharp(buf).rotate().resize(800, 800, { fit: 'inside' }).toBuffer();
  const um = await sharp(upright).metadata();
  return fingerprints(upright, um.width, um.height);
}

/*
 * Inspect an upload. Returns { ok, error } or
 * { ok: true, format, width, height, sha256, hashes: { full, c85, c70, tl, tr, bl, br }, flags: [{ code, text }], measures }.
 */
async function inspect(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return { ok: false, error: 'The file was empty.' };
  if (buf.length > LIMITS.maxBytes) return { ok: false, error: 'Photos can be up to 15 MB.' };
  let meta;
  try { meta = await sharp(buf, { limitInputPixels: LIMITS.maxPixels }).metadata(); } catch {
    return { ok: false, error: 'That file isn’t a photo we can read. Upload a JPEG, PNG or WebP.' };
  }
  if (meta.format === 'heif') return { ok: false, error: 'HEIC photos aren’t supported yet. Export it as a JPEG (on iPhone: Settings, Camera, Formats, Most Compatible).' };
  if (!LIMITS.formats.includes(meta.format)) return { ok: false, error: 'Upload a JPEG, PNG or WebP photo.' };
  // EXIF orientation 5-8 swaps width and height.
  const swap = meta.orientation >= 5;
  const width = swap ? meta.height : meta.width;
  const height = swap ? meta.width : meta.height;
  if (Math.max(width, height) < LIMITS.minLong || Math.min(width, height) < LIMITS.minShort) {
    return { ok: false, error: `That photo is ${width}×${height}. Photos need to be at least ${LIMITS.minLong}×${LIMITS.minShort} pixels.` };
  }
  let stats, sharpness;
  try {
    stats = await sharp(buf).rotate().stats(); // forces a full decode: catches truncated files
    sharpness = await focus(buf);
  } catch {
    return { ok: false, error: 'That file looks damaged. Try exporting the photo again.' };
  }
  const flags = [];
  const lum = stats.channels.slice(0, 3).reduce((s, c) => s + c.mean, 0) / Math.min(3, stats.channels.length);
  if (lum < 40) flags.push({ code: 'dark', text: 'Very dark: check the car is identifiable.' });
  if (lum > 230) flags.push({ code: 'bright', text: 'Very bright or washed out.' });
  if (sharpness < 12) flags.push({ code: 'blurry', text: 'Looks blurry or out of focus.' });
  const mp = (width * height) / 1e6;
  if (meta.format === 'jpeg' && buf.length / mp < 60_000) flags.push({ code: 'compressed', text: 'Heavily compressed: may be a re-saved copy from social media.' });
  const metaText = [meta.exif, meta.xmp, meta.iptc].filter(Boolean).map(b => b.toString('latin1')).join(' ');
  if (AI_MARKERS.test(metaText)) flags.push({ code: 'ai', text: 'The file’s metadata mentions AI generation or a content-credentials manifest.' });
  if (meta.exif && (meta.exif.includes(Buffer.from([0x88, 0x25])) || meta.exif.includes(Buffer.from([0x25, 0x88])))) {
    flags.push({ code: 'location', text: 'Contained location data (removed from every public copy).' });
  }
  if (!meta.exif) flags.push({ code: 'no-camera-data', text: 'No camera data: could be a screenshot or a downloaded copy.' });
  return {
    ok: true, format: meta.format, width, height, flags,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    hashes: await printsOf(buf),
    measures: { brightness: Math.round(lum), sharpness: Math.round(sharpness), bytesPerMp: Math.round(buf.length / mp) },
  };
}

/*
 * Is `b` the same photo as `a`: a copy, resize, re-compression, light edit,
 * or a crop of one by the other? Each side's whole frame is compared with
 * every fingerprint of the other. `full` is the whole-frame distance alone.
 */
function similar(a, b, threshold = 10) {
  if (a.sha256 && a.sha256 === b.sha256) return { match: true, how: 'identical file', distance: 0, full: 0 };
  const ha = a.hashes || {}, hb = b.hashes || {};
  const full = hamming(ha.full, hb.full);
  let distance = full;
  for (const h of Object.values(hb)) distance = Math.min(distance, hamming(ha.full, h));
  for (const h of Object.values(ha)) distance = Math.min(distance, hamming(h, hb.full));
  const how = full <= threshold ? (full === 0 ? 'same image' : 'near-identical image') : 'cropped copy';
  return { match: distance <= threshold, how, distance, full };
}

/*
 * The web copies players see: upright, optional blurred regions (number
 * plates, faces), resized, WebP, no metadata.
 * blur: [{ x, y, w, h }] as fractions of the width and height.
 */
async function derive(buf, { blur = [] } = {}) {
  let img = sharp(buf).rotate();
  const { width, height } = await sharp(await img.toBuffer()).metadata();
  if (blur.length) {
    const base = await img.toBuffer();
    const patches = [];
    for (const r of blur) {
      const left = Math.max(0, Math.round(r.x * width)), top = Math.max(0, Math.round(r.y * height));
      const w = Math.min(width - left, Math.max(8, Math.round(r.w * width))), h = Math.min(height - top, Math.max(8, Math.round(r.h * height)));
      if (w <= 0 || h <= 0) continue;
      const strength = Math.max(12, Math.round(Math.min(w, h) / 4));
      patches.push({ input: await sharp(base).extract({ left, top, width: w, height: h }).blur(strength).toBuffer(), left, top });
    }
    img = sharp(base).composite(patches);
  }
  const upright = await img.toBuffer();
  const out = {};
  for (const [name, size] of Object.entries(SIZES)) {
    out[name] = await sharp(upright).resize(size, size, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  }
  return out;
}

module.exports = { inspect, derive, similar, dhash, hamming, focus, fingerprints, printsOf, LIMITS, SIZES };
