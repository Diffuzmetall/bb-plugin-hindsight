export const PROTOCOL = "bb-hindsight-palette";
export const VERSION = 1;
export const COLOR_MAP = [
  ["background", "background"], ["foreground", "foreground"],
  ["card", "card"], ["card-foreground", "card-foreground"],
  ["popover", "popover"], ["popover-foreground", "popover-foreground"],
  ["primary", "primary"], ["primary-foreground", "primary-foreground"],
  ["secondary", "secondary"], ["secondary-foreground", "secondary-foreground"],
  ["muted", "muted"], ["muted-foreground", "muted-foreground"],
  ["accent", "accent"], ["accent-foreground", "accent-foreground"],
  ["border", "border"], ["input", "input"], ["ring", "ring"],
  ["sidebar", "sidebar"], ["sidebar-foreground", "sidebar-foreground"],
  ["sidebar-accent", "sidebar-accent"], ["sidebar-accent-foreground", "sidebar-accent-foreground"],
  ["sidebar-border", "sidebar-border"], ["sidebar-ring", "sidebar-ring"],
  ["primary", "sidebar-primary"], ["primary-foreground", "sidebar-primary-foreground"],
  ["background", "hs-surface-page"], ["card", "hs-surface-card"],
  ["sidebar", "hs-surface-sidebar"], ["accent", "hs-surface-hover"],
  ["muted", "hs-surface-muted"], ["foreground", "hs-fg-primary"],
  ["muted-foreground", "hs-fg-muted"], ["muted-foreground", "hs-neutral"],
  ["primary-foreground", "hs-fg-on-accent"], ["border", "hs-border-default"],
  ["sidebar-border", "hs-border-subtle"], ["primary", "hs-brand-blue"],
  ["primary", "hs-brand-teal"],
] as const;

export type Rgba8 = readonly [number, number, number, number];
export type Palette = Readonly<{
  mode: "light" | "dark";
  colors: Readonly<Record<(typeof COLOR_MAP)[number][0], Rgba8>>;
}>;
