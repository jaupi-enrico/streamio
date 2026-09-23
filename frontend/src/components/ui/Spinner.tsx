import type { JSX } from "react";

/** The `.spin` loader the vanilla pages swap into a busy button; styled per page. */
export function Spinner(): JSX.Element {
  return <div className="spin" />;
}
