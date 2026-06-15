# Permission Model

Loong should treat every tool call as a policy decision.

## Default Policy

- Reads inside the workspace: allow.
- Writes inside the workspace: allow when a workspace context is active (turn
  workspace path, Studio scope metadata, or profile workspace root).
- Shell commands: ask by default.
- Sandbox commands: ask by default, even when limited to read-only command
  allowlists, because Docker and SSH targets can cross trust boundaries.
- Network access: allow within an active workspace context; ask otherwise.
- Files outside the workspace: ask or deny depending on profile.
- Destructive commands: deny unless explicitly overridden.

## Current CLI Policy

`loong agent` enables read-only workspace tools by default. Write and network
tools are allowed automatically when the turn has workspace context (for
example `loong agent` sets `workspace` to the current working directory).
Org policy `deny` decisions still win. Passing `--allow-write` keeps the
previous explicit opt-in behavior for turns without workspace context.

Interactive terminal sessions prompt for unresolved `ask` decisions; Gateway
and other non-interactive clients queue unresolved `ask` decisions in the
approval inbox (`approval.list`) and emit a `permission` SSE event with phase
`queued`. Studio and the gateway dashboard show inline approve/reject cards in
chat; Desktop also raises a system notification that deep-links to Observe.
Org policy `deny` decisions still win.

`loong gateway` enables workspace write access by default. Set
`LOONG_ALLOW_WRITE=0` or pass `--no-allow-write` to restore the stricter default.

`delegation_run` is registered as an allowlisted orchestration tool in
`loong agent`. It only creates bounded child turns through the current
`LoongAgentRuntime`; those delegated turns still use the same tool registry,
permission engine, workspace policy, and write approvals as ordinary agent
turns.

`sandbox_exec` uses the same conservative read-only command allowlist as
`shell_exec`, but can route execution through local, Docker, or SSH backends.
It remains an `ask` tool by default. Docker execution avoids shell expansion by
calling `docker exec` with fixed arguments. SSH execution quotes a bounded
remote command and requires explicit host/user/workspace input from the caller.
The default `inspect` profile stays narrow: version checks, `git status`, and
safe `rg` inspection. Callers can opt into `versions`, `git-read`,
`search-read`, or `repo-read` profiles when broader read-only inspection is
useful. Expanded Git profiles still reject flags that can invoke external
commands, such as external diff or text conversion.

`browser_snapshot` performs bounded HTTP(S) page inspection and is also an
`ask` tool because it uses network access. It rejects non-HTTP(S) URLs and URLs
with embedded credentials. HTML snapshots include links and form structure, but
hidden and password field values are not exposed in the tool output.
`browser_form_submit` submits basic GET and `application/x-www-form-urlencoded`
POST forms and returns the resulting snapshot. It preserves hidden fields
internally for normal form submission, refuses cross-origin actions unless the
caller explicitly opts in, and rejects unsupported encodings such as multipart
forms.

Gateway direct `tool.invoke` remains stricter: it only runs explicitly
allowlisted read-only non-memory tools. Memory candidate review uses dedicated
Gateway RPCs so list/promote/reject can have separate permission checks without
opening generic memory tool invocation.

Permission handlers receive the original tool input so they can make a decision.
Observer events receive bounded summaries instead of raw inputs or tool results.

## Policy Shape

```yaml
permissions:
  filesystem:
    workspace: allow
    outsideWorkspace: ask
  shell:
    default: ask
    allow:
      - "rg *"
      - "npm test"
    deny:
      - "rm -rf *"
  network:
    default: ask
```

## Decision Flow

```text
tool call
  -> classify tool and input
  -> match workspace and policy
  -> allow / ask / deny
  -> execute if allowed
  -> record decision and result
```

The permission engine should be independent from individual tools so Gateway,
CLI, and future IDE clients can share the same behavior.
