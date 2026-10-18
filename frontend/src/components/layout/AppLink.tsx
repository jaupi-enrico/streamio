import type { AnchorHTMLAttributes, JSX } from "react";
import { Link } from "react-router";
import { oldPageHref } from "../../lib/base";
import { isInApp } from "../../lib/pages";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  /** A site path as the vanilla pages spell it: "/details?id=…", "/account#history". */
  to: string;
};

/**
 * A link to any page of the site. Stays inside this app (client-side, under
 * the current mount) when the target page is implemented here, and is a
 * plain link to the vanilla page otherwise — so clicking through the preview
 * never lands on an old page that has a new version, and never 404s on one
 * that hasn't.
 */
export function AppLink({ to, ...rest }: Props): JSX.Element {
  if (isInApp(to)) return <Link to={to} {...rest} />;
  return <a href={oldPageHref(to)} {...rest} />;
}
