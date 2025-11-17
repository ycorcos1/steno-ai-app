import sharp from "sharp";
import toIco from "to-ico";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const svgPath = join(__dirname, "../public/favicon.svg");
const icoPath = join(__dirname, "../public/favicon.ico");

async function generateFavicon() {
  try {
    // Read the SVG file
    const svgBuffer = readFileSync(svgPath);

    // Convert SVG to PNG at multiple sizes (16x16, 32x32, 48x48)
    const sizes = [16, 32, 48];
    const pngBuffers = await Promise.all(
      sizes.map((size) => sharp(svgBuffer).resize(size, size).png().toBuffer())
    );

    // Convert PNGs to ICO format
    const icoBuffer = await toIco(pngBuffers);

    // Write the ICO file
    writeFileSync(icoPath, icoBuffer);

    console.log(`✅ Successfully created ${icoPath}`);
  } catch (error) {
    console.error("❌ Error generating favicon.ico:", error);
    process.exit(1);
  }
}

generateFavicon();
