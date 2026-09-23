import type { JSX } from "react";
import { AppLink } from "./AppLink";

/** The site footer (home page). */
export function Footer(): JSX.Element {
  return (
    <footer>
      <div className="footer-top">
        <div>
          <div className="footer-brand">STREAMIO</div>
          <div className="footer-tagline">Your unified streaming companion.</div>
        </div>
        <div className="footer-links">
          <div className="footer-col">
            <h4>Navigate</h4>
            <AppLink to="/">Home</AppLink>
            <AppLink to="/catalog">Catalog</AppLink>
            <AppLink to="/search">Search</AppLink>
            <AppLink to="/providers">Providers</AppLink>
            <AppLink to="/account">Account</AppLink>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 Streamio. All rights reserved.</span>
        <span>Built by Streamio</span>
      </div>
    </footer>
  );
}
