# Memory System

Dragon memory has two layers:

## Human-Readable Memory

Markdown files:

- `.dragon/memory/USER.md`: user preferences and stable facts
- `.dragon/memory/PROJECT.md`: project-level context
- `.dragon/memory/MEMORY.md`: curated long-term memory
- `.dragon/memory/notes/YYYY-MM-DD.md`: daily working notes

`dragon agent` and `dragon gateway` inject these files as read-only context
when they exist. Markdown files are bounded by file size and total context
size, recent note enumeration is capped, and missing files are ignored.

## Searchable Memory

The default `file` backend stores JSONL records in `.dragon/memory/records.jsonl`
and uses bounded token scoring. For stronger local search, select the built-in
SQLite backend explicitly:

```bash
dragon agent --memory-backend sqlite "recall project notes"
dragon gateway --memory-backend sqlite
```

The SQLite backend uses Node's `node:sqlite` module and FTS5. It stores durable
memory records in `.dragon/memory/memory.sqlite`, keeps bounded record/database
limits, and does not add an npm-native dependency.

Current SQLite-backed data:

- memory records
- FTS search index

Future SQLite-backed data may include session transcripts, tool result
summaries, and trajectory records.
- optional vector embeddings later

## Recall Flow

```text
new turn
  -> load stable Markdown memory
  -> compact older session history when recent history is truncated
  -> search memory index
  -> select relevant snippets
  -> inject bounded context
```

Memory should be useful, bounded, and auditable.

## Session Compaction

Dragon keeps recent session messages as normal chat history. When a session log
contains older user/assistant messages beyond that recent window, `dragon agent`
and `dragon gateway` can inject a deterministic, bounded compacted context
block. This compaction is read-only and does not promote content into long-term
memory.

## Memory Candidates

Dragon does not silently turn arbitrary conversation into durable memory. When
`dragon agent` or `dragon gateway` sees an explicit remember-style user request
such as `remember`, `note that`, or `keep in mind`, it writes a pending
candidate to:

```text
.dragon/memory/candidates/YYYY-MM-DD.jsonl
```

Each candidate includes the session/run id, inferred `user` or `project` scope,
bounded content, a short assistant preview, and a `pending` status. Candidate
files are review queues: they are not searched by `memory_search`, not injected
as context, and not promoted into the durable memory backend unless a user or
tool deliberately stores them.

Candidate review tools:

- `memory_candidates_list`: read-only, lists pending candidates by default.
- `memory_candidate_promote`: write tool, stores one pending candidate in the
  durable memory backend and marks it `promoted`.
- `memory_candidate_reject`: write tool, marks one pending candidate
  `rejected` without storing durable memory.

Promotion and rejection are explicit write operations. They are subject to the
same permission engine as other Dragon tools. The Gateway also exposes the
same review loop through dedicated RPCs:

- `memory.candidates.list`
- `memory.candidate.promote`
- `memory.candidate.reject`

These RPCs do not relax generic `tool.invoke`; memory tools remain unavailable
through direct generic invocation. In the local dashboard, the Memory tab lists
pending candidates and can promote or reject them when the Gateway permission
policy allows the write operation, such as when started with `--allow-write`.
