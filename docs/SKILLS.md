# Skills System

Dragon skills are on-demand knowledge and workflow packages. The initial format
is compatible with the common `SKILL.md` pattern:

```text
skill-name/
  SKILL.md
  references/
  scripts/
  templates/
  assets/
```

## Progressive Disclosure

Dragon should load skill information in layers:

1. List skill summaries.
2. Load `SKILL.md` when selected.
3. Load reference files only when needed.

This keeps normal turns small while still allowing deep expert workflows.

## Current Runtime

`@dragon/skills` includes a `FileSkillRuntime`:

- scans configured roots for `SKILL.md`
- reads optional simple frontmatter fields: `name`, `description`, `category`
- derives names from frontmatter, first heading, or directory name
- loads bounded text references from `references/`
- skips common generated folders such as `node_modules`, `.git`, and `dist`
- creates new skills under the first configured writable root, creating that
  root when needed
- appends improvement evidence to `references/improvements.md`

Dragon exposes four skill tools in agent mode:

- `skill_list`: read-only skill discovery
- `skill_load`: read-only skill loading with bounded references
- `skill_create`: write tool for creating a new `SKILL.md` package
- `skill_improve`: write tool for appending reviewable evidence to a skill

The CLI also supports local slash commands that do not call a model provider:

- `dragon agent /skills`: list skills from configured roots
- `dragon agent /skills <query>`: list matching skills
- `dragon agent /skills load <name>`: print one loaded skill and bounded
  reference summaries

## Self-Improvement

Dragon should be able to:

- create a new skill from repeated work
- improve a skill from success or failure evidence
- test a skill with a dry-run task
- keep skill changes visible and reviewable

Skills are not hidden model state. They are files the user can inspect.
`skill_improve` intentionally writes evidence into `references/improvements.md`
instead of rewriting the main `SKILL.md`; a later curator workflow can promote
evidence into the skill body after review.

Skill references created by `skill_create` are files directly under
`references/`; nested reference paths are rejected until recursive reference
loading is supported. Improvement evidence is JSON-safe and size-bounded, and
`references/improvements.md` must be a normal file inside the skill directory,
not a symbolic link or hard link.

CLI agent mode always includes `.dragon/skills` as a writable fallback root.
Additional roots from `DRAGON_SKILL_ROOTS` or `--skill-root` may point to
directories that do not exist yet; Dragon creates the first writable root when
`skill_create` needs it.
