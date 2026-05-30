import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const shards = Math.max(1, Number(process.env.LOONG_TEST_SHARDS ?? 3));
for (let shard = 0; shard < shards; shard += 1) {
  process.stdout.write(`\n--- shard ${shard + 1}/${shards} ---\n`);
  const result = spawnSync("pnpm", ["exec", "tsx", "src/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      LOONG_TEST_SHARD: String(shard),
      LOONG_TEST_SHARDS: String(shards),
    },
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
