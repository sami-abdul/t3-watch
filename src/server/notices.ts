/** Wording that the text status and the page share. No runtime imports, so the page can use it too. */

/** Follows the line saying since when Watch cannot reach the internet. */
export const HELD_NOTICE = "Failures of checks that need it are held for up to an hour each, and nothing alerts meanwhile.";

/** Follows the line saying since when Watch's own connection has been slow. */
export const SLOW_NOTICE =
  "Web and vendor checks whose connections time out or drop are held for up to an hour each, and nothing alerts for them meanwhile. A refused connection or an error answer still counts.";

export const PROBES_DISAGREE_NOTICE =
  "Watch's probe addresses do not answer while checks that need the internet pass, so it is not holding failures. If this network blocks them, set probeUrls in Watch's config.json, in the T3_WATCH_HOME folder, ~/.t3-watch by default.";

/** The scan's note on a repository with no GitHub Actions runs yet, which the review lists apart. */
export const NO_RUNS_NOTE = "No GitHub Actions runs yet";
