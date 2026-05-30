export type TestCase = [name: string, run: () => Promise<void>];

export interface RunTestsOptions {
  /** Run only tests whose name includes this substring (case-insensitive). */
  only?: string;
  /** Shard index 0..shards-1 (use with `shards`). */
  shard?: number;
  /** Total shard count. */
  shards?: number;
}

export function filterTests(tests: TestCase[], options: RunTestsOptions = {}): TestCase[] {
  const envOnly = process.env.LOONG_TEST_ONLY?.trim();
  const envShard = process.env.LOONG_TEST_SHARD?.trim();
  const envShards = process.env.LOONG_TEST_SHARDS?.trim();

  const only = options.only ?? envOnly;
  const shard = options.shard ?? (envShard !== undefined && envShard !== "" ? Number(envShard) : undefined);
  const shards = options.shards ?? (envShards !== undefined && envShards !== "" ? Number(envShards) : undefined);

  let filtered = tests;
  if (only) {
    const needle = only.toLowerCase();
    filtered = filtered.filter(([name]) => name.toLowerCase().includes(needle));
  }
  if (shard !== undefined && shards !== undefined && Number.isFinite(shard) && Number.isFinite(shards) && shards > 0) {
    const index = Math.floor(shard);
    const total = Math.floor(shards);
    filtered = filtered.filter((_, i) => i % total === index);
  }
  return filtered;
}

export async function runTests(tests: TestCase[], options: RunTestsOptions = {}): Promise<void> {
  const selected = filterTests(tests, options);
  if (selected.length === 0) {
    throw new Error("No tests selected. Check LOONG_TEST_ONLY or LOONG_TEST_SHARD settings.");
  }
  for (const [name, test] of selected) {
    await test();
    process.stdout.write(`ok - ${name}\n`);
  }
}
