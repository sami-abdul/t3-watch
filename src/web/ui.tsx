import { motion } from "motion/react";
import { type ReactNode, useRef } from "react";

import { FluidHoverHighlight } from "~/fluid/fluid-hover-highlight";
import { useFluidHover, useRegisterFluidHoverItem } from "~/fluid/hooks/use-fluid-hover";
import { fontWeights } from "~/fluid/lib/font-weight";
import { useShape } from "~/fluid/lib/shape-context";
import { spring } from "~/fluid/lib/springs";
import { typeClass } from "~/fluid/lib/type-scale";
import { Badge, type BadgeColor } from "~/fluid/ui/badge";
import { cn } from "~/lib/utils";

export type Tone = { readonly color: BadgeColor; readonly label: string };
export const outcomeTone: Record<"pass" | "fail" | "unknown", Tone> = {
  pass: { color: "green", label: "Passing" },
  fail: { color: "red", label: "Failing" },
  unknown: { color: "amber", label: "Could not run" },
};

export function Heading({ children, as = "h2" }: { readonly children: ReactNode; readonly as?: "h1" | "h2" }) {
  const Tag = as;
  return (
    <Tag
      className={cn("text-foreground", typeClass(as === "h1" ? "display" : "subtitle"))}
      style={{ fontVariationSettings: as === "h1" ? fontWeights.bold : fontWeights.semibold }}
    >
      {children}
    </Tag>
  );
}

export function Muted({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return <p className={cn("text-muted-foreground", typeClass("body"), className)}>{children}</p>;
}

/** The check mark draws in on tick and retracts on untick, as in the Fluid checkbox. */
function Tick({ checked }: { readonly checked: boolean }) {
  return (
    <span className="relative mt-0.5 size-4 shrink-0" aria-hidden>
      <span
        className={cn(
          "absolute inset-0 rounded-sm border transition-colors duration-80",
          checked ? "border-transparent" : "border-muted-foreground",
        )}
      />
      <svg viewBox="0 0 24 24" className="absolute -inset-px size-[18px] text-foreground">
        <motion.path
          d="M6 12L10 16L18 8"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          // Opacity too: a round line cap leaves a dot at zero length.
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={
            checked
              ? { type: "tween", duration: spring.fast.duration, ease: "easeOut" }
              : { type: "tween", ...spring.fast.exit, ease: "easeIn" }
          }
        />
      </svg>
    </span>
  );
}

export interface RowProps {
  readonly key: string;
  readonly title: string;
  readonly detail?: ReactNode;
  readonly badge?: Tone | null;
  readonly action?: ReactNode;
  /** A tickable row. Null for a plain line. */
  readonly checked?: boolean | null;
  readonly onToggle?: (() => void) | null;
  readonly onOpen?: (() => void) | null;
}

function Row({
  index,
  registerItem,
  title,
  detail,
  badge,
  action,
  checked = null,
  onToggle = null,
  onOpen = null,
}: Omit<RowProps, "key"> & {
  readonly index: number;
  readonly registerItem: (index: number, element: HTMLElement | null) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const onClick = onToggle ?? onOpen;
  useRegisterFluidHoverItem(onClick === null ? undefined : registerItem, index, ref);
  const interactive = onClick !== null;
  const tickable = onToggle !== null;
  return (
    <li
      ref={ref}
      role={tickable ? "checkbox" : interactive ? "button" : undefined}
      aria-checked={tickable ? (checked ?? false) : undefined}
      aria-label={interactive ? title : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick ?? undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn("relative z-10 flex items-start gap-3 px-3 py-2.5 outline-none", interactive && "cursor-pointer")}
    >
      {tickable ? <Tick checked={checked ?? false} /> : null}
      <span className="min-w-0 flex-1 space-y-0.5">
        {/* Weight changes without reflow: the invisible copy reserves the semibold width. */}
        <span className={cn("inline-grid", typeClass("body"))}>
          <span aria-hidden className="invisible col-start-1 row-start-1" style={{ fontVariationSettings: fontWeights.semibold }}>
            {title}
          </span>
          <span
            className={cn(
              "col-start-1 row-start-1 transition-[color,font-variation-settings] duration-80",
              checked === false ? "text-muted-foreground" : "text-foreground",
            )}
            style={{ fontVariationSettings: checked === false ? fontWeights.normal : fontWeights.semibold }}
          >
            {title}
          </span>
        </span>
        {detail ? <span className={cn("block text-muted-foreground", typeClass("caption"))}>{detail}</span> : null}
      </span>
      {badge ? (
        <Badge color={badge.color} size="compact" className="shrink-0">
          {badge.label}
        </Badge>
      ) : null}
      {action ? (
        // Buttons inside a clickable row act on their own.
        <span className="flex shrink-0 gap-1.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {action}
        </span>
      ) : null}
    </li>
  );
}

/** One fluid hover list: a single highlight glides to the row nearest the pointer. */
export function RowList({ label, rows }: { readonly label: string; readonly rows: ReadonlyArray<RowProps> }) {
  const ref = useRef<HTMLUListElement>(null);
  const hover = useFluidHover(ref, { gapClick: false });
  const shape = useShape();
  if (rows.length === 0) return null;
  return (
    <ul
      ref={ref}
      aria-label={label}
      onMouseEnter={hover.handlers.onMouseEnter}
      onMouseMove={hover.handlers.onMouseMove}
      onMouseLeave={hover.handlers.onMouseLeave}
      className={cn("relative list-none border border-border p-1", shape.container)}
    >
      <FluidHoverHighlight hover={hover} className={shape.bg} />
      {rows.map(({ key, ...row }, index) => (
        <Row key={key} index={index} registerItem={hover.registerItem} {...row} />
      ))}
    </ul>
  );
}

export function Section({ title, children, aside }: { readonly title: string; readonly children: ReactNode; readonly aside?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <Heading>{title}</Heading>
        {aside}
      </div>
      {children}
    </section>
  );
}
