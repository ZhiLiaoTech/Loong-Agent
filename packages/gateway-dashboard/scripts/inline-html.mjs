import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
let html = readFileSync(join(root, "index.html"), "utf8");

const cssFile = readdirSync(join(root, "assets")).find(name => name.endsWith(".css"));
const jsFile = readdirSync(join(root, "assets")).find(name => name.endsWith(".js"));
if (!cssFile || !jsFile) {
  throw new Error("Dashboard build assets missing.");
}

const css = readFileSync(join(root, "assets", cssFile), "utf8");
const js = readFileSync(join(root, "assets", jsFile), "utf8");

html = html.replace(/<link[^>]+href="\/assets\/[^"]+\.css"[^>]*>/, `<style>${css}</style>`);
html = html.replace(/<script[^>]+src="\/assets\/[^"]+\.js"[^>]*><\/script>/, `<script type="module">${js}</script>`);

writeFileSync(join(root, "index.html"), html, "utf8");
