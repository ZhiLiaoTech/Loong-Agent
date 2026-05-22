import sharp from "sharp";
import { fileURLToPath } from "url";
import path from "path";

const file = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../docs/images/banner.original.png");
const out = process.argv[3] ?? path.join(path.dirname(file), "banner.png");

const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;

function rowIsBorder(y) {
  let dark = 0;
  const samples = 48;
  for (let i = 0; i < samples; i++) {
    const x = Math.floor((i + 0.5) * width / samples);
    const idx = (y * width + x) * channels;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    if (r < 28 && g < 28 && b < 40) dark++;
  }
  return dark >= samples * 0.92;
}

let top = 0;
while (top < height && rowIsBorder(top)) top++;

let bottom = height - 1;
while (bottom > top && rowIsBorder(bottom)) bottom--;

const cropHeight = bottom - top + 1;
console.log(`${path.basename(file)}: ${width}x${height} -> crop y=${top} h=${cropHeight}`);

await sharp(file)
  .extract({ left: 0, top, width, height: cropHeight })
  .png({ compressionLevel: 9 })
  .toFile(out);

console.log(`wrote ${out}`);
