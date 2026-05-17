# Permission Model

Dragon should treat every tool call as a policy decision.

## Default Policy

- Reads inside the workspace: allow.
- Writes inside the workspace: ask until trusted.
- Shell commands: ask by default.
- Sandbox commands: ask by default, even when limited to read-only command
  allowlists, because Docker and SSH targets can cross trust boundaries.
- Network access: ask by default.
- Files outside the workspace: ask or deny depending on profile.
- Destructive commands: deny unless explicitly overridden.

## Current CLI Policy

`dragon agent` enables read-only workspace tools by default. The `file_patch`
write tool and memory candidate promotion/rejection tools are registered with
an `ask` policy. In an interactive terminal, the CLI prompts the user before
execution; in non-interactive mode, unresolved `ask` decisions are skipped and
reported back to the model. Passing `--allow-write` explicitly allows
`file_patch`, skill authoring tools, and memory candidate promotion/rejection
without prompting.

`sandbox_exec` uses the same conservative read-only command allowlist as
`shell_exec`, but can route execution through local, Docker, or SSH backends.
It remains an `ask` tool by default. Docker execution avoids shell expansion by
calling `docker exec` with fixed arguments. SSH execution quotes a bounded
remote command and requires explicit host/user/workspace input from the caller.

`browser_snapshot` performs bounded HTTP(S) page inspection and is also an
`ask` tool because it uses network access. It rejects non-HTTP(S) URLs and URLs
with embedded credentials.

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
