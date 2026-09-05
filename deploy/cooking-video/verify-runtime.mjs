import { execFileSync } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";

const expected = {
  node: "v24.8.0",
  pnpm: "10.11.0",
  remotion: "4.0.520",
  react: "19.1.0",
  typescript: "5.9.3",
};

function command(file, args = []) {
  return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function packageVersion(file, name) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return parsed.dependencies?.[name] ?? parsed.devDependencies?.[name];
}

const actual = {
  node: process.version,
  pnpm: command("pnpm", ["--version"]),
  remotion: packageVersion("packages/cooking-video-remotion/package.json", "remotion"),
  react: packageVersion("packages/cooking-video-remotion/package.json", "react"),
  typescript: packageVersion("packages/cooking-video-remotion/package.json", "typescript"),
};

for (const [name, version] of Object.entries(expected)) {
  if (actual[name] !== version) throw new Error(`${name} version mismatch: expected ${version}, found ${actual[name] ?? "missing"}.`);
}

command("ffmpeg", ["-version"]);
command("ffprobe", ["-version"]);
command("chromium", ["--version"]);
for (const font of [
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]) accessSync(font, constants.R_OK);

process.stdout.write(`${JSON.stringify({ ok: true, ...actual })}\n`);
