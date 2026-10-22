/**
 * A product's name as Home compares it: letters and digits of any script, without case or accents,
 * so "Storefront", "store-front" and "STOREFRONT" are one product and "Café" is "Cafe". A name with
 * no letter or digit has no key and names nothing. Kept apart from code that reads files, so the
 * page can import it.
 */
export const productKey = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
