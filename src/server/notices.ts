/** Wording that the text status and the page share. No runtime imports, so the page can use it too. */

/** Follows the line saying since when Watch cannot reach the internet. */
export const HELD_NOTICE = "Failures of checks that need it are held for up to an hour each, and nothing alerts meanwhile.";

export const PROBES_DISAGREE_NOTICE =
  "Watch's probe addresses do not answer while checks that need the internet pass, so it is not holding failures. If this network blocks them, set probeUrls in Watch's config.json, ~/.t3-watch/config.json by default.";
