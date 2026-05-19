import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
let fragment = readFileSync(join(pkgRoot, "index.fragment.html"), "utf8");
if (fragment.startsWith("`")) {
  fragment = fragment.slice(1);
}
const start = fragment.indexOf("<style>") + "<style>".length;
const end = fragment.lastIndexOf("</style>");
const legacy = fragment.slice(start, end);
writeFileSync(join(pkgRoot, "src", "styles-legacy.css"), legacy, "utf8");
