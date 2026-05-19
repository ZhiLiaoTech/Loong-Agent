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

// Escape any literal </script> or </style> in the bundle content so it does
// not prematurely close the inlined tag. Without this, the browser stops
// parsing the script at the first embedded "</script>" sequence (e.g. from a
// React string literal) and the rest of the bundle leaks into the DOM as text.
const escapeForScript = source => source.replace(/<\/script/gi, "<\\/script");
const escapeForStyle = source => source.replace(/<\/style/gi, "<\\/style");

// Replace ALL occurrences of the external asset references — Vite emits the
// same `<script src=...>` tag multiple times (preload + main + crossorigin
// variants). The previous single-replace left stale external references in
// the served HTML.
html = html.replace(/<link[^>]+href="\/assets\/[^"]+\.css"[^>]*>/g, `<style>${escapeForStyle(css)}</style>`);
html = html.replace(/<script[^>]+src="\/assets\/[^"]+\.js"[^>]*><\/script>/g, () => `<script type="module">${escapeForScript(js)}</script>`);

writeFileSync(join(root, "index.html"), html, "utf8");
