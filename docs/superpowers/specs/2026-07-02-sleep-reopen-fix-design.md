# Design: Fix Sleep Entry Not Reopening When "Woke" Is Cleared

Item 1 of 9 in the [dogfood PR sequence](../plans/2026-07-01-dogfood-triage.md).

## Problem

Clearing the "Woke" field on an existing sleep entry and saving does not reopen the
entry — it stays marked as finished with its old end time.

## Root cause

`gather('sleep')` in `js/sheets.js` only sets `base.end` when `#f-end` has a value:

```js
if (type === 'sleep') {
  base.quality = segVal('quality');
  const end = $('#f-end').value;
  if (end) base.end = dtToISO(end);
}
```

When editing, `saveLog()` passes this object straight into `updateEntry(id, patch)`
(`js/store.js`), which applies the patch with `Object.assign(e, patch)`.
`Object.assign` only overwrites keys present on the source object — it has no way to
express "delete this field." When `end` is empty, `patch` has no `end` key at all, so
the entry's existing `end` value survives untouched. The entry never returns to
"ongoing," even though falsy `e.end` is already the "still asleep" sentinel used
throughout the codebase (`sleep.js`, `home.js`, `store.js` derive logic).

## Fix

Set `base.end` explicitly, including the empty case:

```js
if (type === 'sleep') {
  base.quality = segVal('quality');
  const end = $('#f-end').value;
  base.end = end ? dtToISO(end) : null;
}
```

Explicit `null` forces `Object.assign` to actually overwrite `e.end`. For new entries
this is harmless — `addEntry()` just stores `end: null`, which every falsy check in
the codebase already treats the same as `undefined`.

## Scope

- `js/sheets.js`: one-line change in `gather()`.
- No backend changes, no other views affected.

## Testing

`gather()` is not exported and reads DOM elements directly (`$('#f-end')`), so it
isn't unit-testable without DOM mocking. Cover the fix end-to-end instead:

New `tests/sleep-reopen.test.js` (Playwright), following the `tests/datetime.test.js`
pattern (`log:open` sleep → fill form → save):

1. Log a sleep entry with both start and end set.
2. Reopen it for editing.
3. Clear the "Woke" field and save.
4. Assert the entry now reads as ongoing (no end time / active awake-timer state),
   matching how existing suites already assert "ongoing" sleep state.
