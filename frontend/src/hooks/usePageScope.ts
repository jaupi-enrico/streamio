import { useLayoutEffect } from "react";

/**
 * The Google Fonts request each vanilla page made. They differ slightly (the
 * optical-size axis on home, italics on account/admin), and the glyph widths
 * differ with them, so a page loads the one its original did.
 */
const FONTS = {
  default: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600;700&display=swap",
  opsz: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap",
  italic:
    "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap",
} as const;

export type FontVariant = keyof typeof FONTS;

/**
 * Activates a page's stylesheet, font and tab title.
 *
 * Page CSS is scoped to `:root[data-page="<scope>"]` at build time
 * (build/scope-page-css.ts); `scope` is the folder the stylesheet lives in,
 * which is not always the route (verify-email, reset-password and tv share
 * one). A layout effect, so the attribute is set before the browser paints
 * the page's first frame.
 */
export function usePageScope(scope: string, title: string, font: FontVariant = "default"): void {
  useLayoutEffect(() => {
    document.documentElement.dataset.page = scope;
    document.title = title;
    const link = document.getElementById("streamio-font") as HTMLLinkElement | null;
    if (link && link.href !== FONTS[font]) link.href = FONTS[font];
  }, [scope, title, font]);
}
