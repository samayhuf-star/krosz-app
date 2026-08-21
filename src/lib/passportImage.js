const MIN_EDGE = 900;

export async function inspectPassportImage(file) {
  if (!file?.type?.startsWith('image/')) {
    return { supported: false, canEnhance: false, checks: [{ code: 'PDF_REVIEW', level: 'review', message: 'PDF uploaded. Image enhancement is available for photos; the original PDF will still be checked.' }] };
  }
  const bitmap = await createImageBitmap(file);
  const checks = [];
  if (Math.min(bitmap.width, bitmap.height) < MIN_EDGE) checks.push({ code: 'LOW_RESOLUTION', level: 'review', message: 'Image resolution is low. A clearer photo may be needed.' });
  const ratio = Math.max(bitmap.width, bitmap.height) / Math.min(bitmap.width, bitmap.height);
  if (ratio < 1.25 || ratio > 2.2) checks.push({ code: 'UNUSUAL_FRAMING', level: 'review', message: 'Passport page framing looks unusual. Check that all four corners are visible.' });

  const sample = document.createElement('canvas');
  sample.width = 96; sample.height = 64;
  const sctx = sample.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(bitmap, 0, 0, sample.width, sample.height);
  const px = sctx.getImageData(0, 0, sample.width, sample.height).data;
  let dark = 0, clippedBright = 0, sum = 0, sumSq = 0;
  const luminance = new Float32Array(sample.width * sample.height);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    luminance[p] = l;
    sum += l; sumSq += l * l;
    if (l < 35) dark++;
    // Only near-clipped pixels count toward glare. Passport paper/background is
    // naturally bright, so the old >245 global threshold produced false glare.
    if (l > 252) clippedBright++;
  }
  const total = luminance.length;
  const mean = sum / total;
  const stdDev = Math.sqrt(Math.max(0, sumSq / total - mean * mean));
  // Blur must be measured spatially, not by comparing adjacent pixels in the
  // flattened RGBA stream (which also compared the end of one row to the next).
  let edgeSum = 0, edgeSamples = 0;
  for (let y = 1; y < sample.height - 1; y++) {
    for (let x = 1; x < sample.width - 1; x++) {
      const p = y * sample.width + x;
      edgeSum += Math.abs(luminance[p + 1] - luminance[p - 1]) + Math.abs(luminance[p + sample.width] - luminance[p - sample.width]);
      edgeSamples += 2;
    }
  }
  const edgeStrength = edgeSamples ? edgeSum / edgeSamples : 0;
  if (dark / total > 0.28) checks.push({ code: 'TOO_DARK', level: 'review', message: 'The image appears dark. Use even lighting without shadows.' });
  // Glare from a flash is a LOCALIZED hotspot of near-clipped pixels surrounded
  // by darker text — not a uniformly bright page. A clean passport scan lights
  // the whole page evenly, so flagging on a global clipped ratio (the old check)
  // produced false positives. Detect glare as a concentrated tile of clipping
  // that stands out from the rest of the image.
  const TILE_X = 6, TILE_Y = 4;
  const tileW = Math.floor(sample.width / TILE_X), tileH = Math.floor(sample.height / TILE_Y);
  let hotspot = false;
  for (let ty = 0; ty < TILE_Y && !hotspot; ty++) {
    for (let tx = 0; tx < TILE_X && !hotspot; tx++) {
      let tileClipped = 0, tileSum = 0, tileN = 0;
      const x0 = tx * tileW, y0 = ty * tileH;
      for (let y = y0; y < y0 + tileH && y < sample.height; y++) {
        for (let x = x0; x < x0 + tileW && x < sample.width; x++) {
          const l = luminance[y * sample.width + x];
          tileSum += l; tileN++;
          if (l > 252) tileClipped++;
        }
      }
      if (!tileN) continue;
      const tileClipRatio = tileClipped / tileN;
      const tileMean = tileSum / tileN;
      // A glare hotspot: this tile is mostly clipped AND clearly brighter than
      // the overall page (a uniform bright page won't clear the +30 gap).
      if (tileClipRatio > 0.45 && tileMean - mean > 30) hotspot = true;
    }
  }
  if (hotspot) checks.push({ code: 'GLARE', level: 'review', message: 'Strong glare may hide passport details. Retake without flash if any text is unreadable.' });
  // Low global contrast alone is not blur. Require both low tonal variation and
  // weak spatial edges so clean, pale passport scans do not fail this check.
  if (stdDev < 22 && edgeStrength < 7) checks.push({ code: 'POSSIBLE_BLUR', level: 'review', message: 'The image may be blurred. Retake only if passport text is not sharp.' });
  const width = bitmap.width, height = bitmap.height;
  bitmap.close();
  return { supported: true, canEnhance: true, width, height, checks, passed: checks.length === 0 };
}

export async function createEnhancedPassportScan(file) {
  if (!file?.type?.startsWith('image/')) return null;
  const bitmap = await createImageBitmap(file);
  // Preserve the complete passport frame. Never auto-crop a compliance document:
  // even a small edge trim can remove a page corner, security feature or MRZ data.
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.filter = 'contrast(1.12) brightness(1.03) saturate(0.95)';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) return null;
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '-enhanced.jpg', { type: 'image/jpeg', lastModified: Date.now() });
}