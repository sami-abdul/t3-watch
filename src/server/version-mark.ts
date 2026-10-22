/**
 * Where the inline view's version goes. The view is built with this mark in its place, and the
 * server writes its own version over it as it serves the view, so the two always agree, even in a
 * checkout whose view was built before a version change. Kept apart from version.ts, which reads
 * files, so the browser build can import it.
 */
export const VERSION_MARK = "__T3W_VERSION__";
