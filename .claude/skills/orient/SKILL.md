---
name: orient
description: Use at the start of any Hearth session before exploring files, planning changes, or answering architecture questions. Loads the codebase quick reference to avoid re-deriving stable facts.
user_invocable: true
---

# Orient — Hearth Session Start

## When to use

Invoke before any substantive Hearth work: planning a feature, diagnosing a bug, writing a plan, answering an architecture question, or starting a delegation run. Skip only if you already read the quickref in this session.

## Steps

1. **Read `docs/codebase-quickref.md`** in full. It is under 150 lines. This is the only file you need for orientation.

2. **Do not read additional files** to confirm things already stated in the quickref — the quickref is authoritative for stable facts (file purposes, export shapes, patterns). Read source files only when you need the current exact content of a specific function.

3. **What the quickref does NOT cover** (look these up from source):
   - Exact line numbers (grep for the function name instead)
   - Current implementation state of in-progress work (read the plan doc or git log)
   - Test file content (read the test file directly)
   - Specific CSS values (read `styles.css`)

4. **After reading**, you have enough to:
   - Answer "where does X live?" questions
   - Identify which files a plan needs to touch
   - Write exact `rg` commands to locate functions
   - Understand data flow without tracing imports

## Keeping the quickref current

When you make a change that alters a stable fact in the quickref (new exported function, renamed file, new Go server file, changed test command), update `docs/codebase-quickref.md` in the same commit. The quickref drifts if nobody maintains it — treat it like a changelog entry for the architecture layer.
