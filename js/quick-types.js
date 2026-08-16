// quick-types.js: the universe of types Home's quick-action orbs can show,
// in the pre-customization order. Lives in its own zero-dependency module
// (rather than being exported from home.js) so store.js can import it
// without pulling in home.js's own imports -- home.js imports sky.js, whose
// top-level module code calls document.addEventListener, which breaks any
// unit test that stubs `document` without that method.
export const QUICK_TYPES = ['sleep', 'feed', 'bottle', 'diaper', 'medicine', 'play', 'bath', 'hygiene'];
