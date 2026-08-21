// Deterministic client-side photo metrics for the shared Photo Compliance engine.
// Uses browser FaceDetector when available; otherwise returns null face metrics so
// the backend can route to manual review instead of inventing certainty.

export async function inspectVisaPhoto(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Use a JPG or PNG image for the visa photo.');
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width, height = bitmap.height;
  const canvas = document.createElement('canvas');
  const sampleW = 160, sampleH = Math.max(160, Math.round(sampleW * height / Math.max(width, 1)));
  canvas.width = sampleW; canvas.height = sampleH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, sampleW, sampleH);
  const img = ctx.getImageData(0, 0, sampleW, sampleH);
  const px = img.data;

  let mean = 0, edgeDiff = 0, count = 0;
  const lumas = new Float32Array(sampleW * sampleH);
  for (let y = 0; y < sampleH; y++) for (let x = 0; x < sampleW; x++) {
    const i = (y * sampleW + x) * 4;
    const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    lumas[y * sampleW + x] = l; mean += l; count++;
    if (x > 0) edgeDiff += Math.abs(l - lumas[y * sampleW + x - 1]);
    if (y > 0) edgeDiff += Math.abs(l - lumas[(y - 1) * sampleW + x]);
  }
  mean /= Math.max(count, 1);
  const blurScore = Math.min(1, (edgeDiff / Math.max(count * 2, 1)) * 9);

  // Estimate background from border pixels only. A compliant studio background
  // should be both bright (for white rules) and relatively uniform.
  const border = [];
  const bandX = Math.max(3, Math.round(sampleW * .08));
  const bandY = Math.max(3, Math.round(sampleH * .08));
  for (let y = 0; y < sampleH; y++) for (let x = 0; x < sampleW; x++) {
    if (x < bandX || x >= sampleW - bandX || y < bandY || y >= sampleH - bandY) border.push(lumas[y * sampleW + x]);
  }
  const bgMean = border.reduce((a,b)=>a+b,0) / Math.max(border.length,1);
  const variance = border.reduce((a,b)=>a + Math.pow(b-bgMean,2),0) / Math.max(border.length,1);
  const backgroundUniformity = Math.max(0, Math.min(1, 1 - Math.sqrt(variance) * 4));

  let faceCount = null, facePct = null, frontal = null;
  try {
    if ('FaceDetector' in window) {
      // eslint-disable-next-line no-undef
      /** @type {any} */
      const FaceDetectorCtor = window.FaceDetector;
      const detector = new FaceDetectorCtor({ fastMode: true, maxDetectedFaces: 3 });
      const faces = await detector.detect(bitmap);
      faceCount = faces.length;
      if (faces.length === 1) {
        const box = faces[0].boundingBox;
        facePct = Math.round((box.height / Math.max(height, 1)) * 100);
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        frontal = Math.abs(cx / width - .5) <= .16 && cy / height >= .28 && cy / height <= .58;
      }
    }
  } catch {
    faceCount = null; facePct = null; frontal = null;
  }
  bitmap.close();
  return {
    width, height, bytes: file.size, mime_type: String(file.type || '').toLowerCase(),
    face_count: faceCount, face_pct: facePct, background_uniformity: Number(backgroundUniformity.toFixed(3)),
    background_brightness: Number(bgMean.toFixed(3)), blur_score: Number(blurScore.toFixed(3)), frontal,
    mean_brightness: Number(mean.toFixed(3)),
  };
}
