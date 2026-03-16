import { DEVICE_TEMPLATES } from "../../src/deviceLibrary";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, "../../src/deviceLibrary.fallback.json");

writeFileSync(outPath, JSON.stringify(DEVICE_TEMPLATES, null, 2), "utf-8");
console.log(`Generated ${outPath} (${DEVICE_TEMPLATES.length} templates)`);
