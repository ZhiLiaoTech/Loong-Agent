import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const body = readFileSync(join(pkgRoot, "body.html"), "utf8");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dragon · 潜龙</title>
</head>
${body}
</html>
`;

writeFileSync(join(pkgRoot, "index.html"), html, "utf8");
