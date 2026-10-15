import { type CxOptions, cx } from "class-variance-authority";
import { extendTailwindMerge } from "tailwind-merge";

// The Fluid Functionalism type roles. Unregistered, tailwind-merge reads text-caption as a
// colour and drops it next to text-muted-foreground.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["display", "title", "subtitle", "body", "caption", "micro"] } },
});

export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}
