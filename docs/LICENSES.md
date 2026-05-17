# Licenses And Attribution

Dragon is MIT licensed by default.

## Upstream Compatibility

### OpenClaw

OpenClaw is MIT licensed. Code may be copied, modified, and redistributed as
long as the upstream copyright and MIT license notice are preserved.

Dragon policy:

- keep attribution in migrated files or folder-level `MIGRATION.md`
- record upstream paths
- avoid unnecessary whole-directory copies

### Hermes Agent

Hermes Agent is MIT licensed. Dragon does not import Python runtime code, but
may reimplement Hermes ideas in TypeScript. If a file is copied or closely
translated, preserve attribution.

Dragon policy:

- prefer TypeScript reimplementation
- cite the design source in docs when relevant
- preserve MIT attribution if any code is copied

### Claude Code Sourcemap

The local Claude Code source map reconstruction is not a safe code reuse source
for Dragon. Treat it as research-only material.

Dragon policy:

- do not copy source
- do not translate source
- use only high-level behavioral and product inspiration

## Future Third-Party Code

When adding third-party code:

- verify license before copying
- keep notice files
- add the source to this document
- prefer package dependencies over vendored code when possible

