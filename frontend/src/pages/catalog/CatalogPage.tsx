/**
 * The active provider's catalogue — a port of public/catalog.html +
 * scripts/catalog.js: `GET /api/home`, the featured category as a carousel
 * and every other category as a grid.
 */
import { useRef, useState, type JSX } from "react";
import { AppLink } from "../../components/layout/AppLink";
import { BottomNav } from "../../components/layout/BottomNav";
import { TopNav } from "../../components/layout/TopNav";
import { useLoadPreferences } from "../../hooks/usePreferences";
import { usePageScope } from "../../hooks/usePageScope";
import { useQuietSession } from "../../hooks/useQuietSession";
import { usePublicQuery } from "../../lib/api";
import { withProvider } from "../../lib/provider-selection";
import { isSeries, showMeta } from "../../lib/show-meta";
import type { HomeCategory, ListItem } from "../../lib/types";
import "./catalog.css";

/**
 * The featured category is recognised by name, since providers name it in
 * their own words.
 */
function isFeaturedCategory(name: string | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return n.includes("evidenza") || n.includes("featured") || n.includes("highlight") || n.includes("spotlight");
}

function detailsPath(item: ListItem): string {
  return `/details?id=${encodeURIComponent(item.id)}`;
}

/**
 * Banner first, then the poster, then the plain background. The vanilla page
 * meant to do this but its inline `onerror` couldn't reach the module's
 * handler, so a dead banner just showed a broken image.
 */
function FeatImage({ banner, poster }: { banner: string; poster: string }): JSX.Element {
  const [src, setSrc] = useState(banner || poster);
  if (!src) return <div className="feat-card-thumb-bg" />;
  return (
    <img
      className="feat-card-img"
      src={src}
      alt=""
      onError={() => setSrc(src === banner && poster && poster !== banner ? poster : "")}
    />
  );
}

function FeatCard({ item }: { item: ListItem }): JSX.Element {
  const meta = showMeta(item, 4);
  return (
    <AppLink to={detailsPath(item)} className="feat-card">
      <div className="feat-card-thumb">
        <FeatImage banner={item.banner || ""} poster={item.poster || ""} />
        {item.rating ? <div className="feat-card-rating">★ {item.rating}</div> : null}
        <div className="feat-badge">{isSeries(item) ? "Series" : "Movie"}</div>
        <div className="feat-card-overlay" />
      </div>
      <div className="feat-card-body">
        <div className="feat-card-title">{item.title || "Unknown"}</div>
        {meta && <div className="feat-card-meta">{meta}</div>}
      </div>
    </AppLink>
  );
}

function Card({ item }: { item: ListItem }): JSX.Element {
  const poster = item.poster || "";
  // The overlay sits over the poster and has less room than the body line.
  const meta = showMeta(item);
  const overlayMeta = showMeta(item, 2);
  const genre = item.genres?.[0]?.name;
  return (
    <AppLink to={detailsPath(item)} className="card">
      <div className="card-poster" style={poster ? { backgroundImage: `url(${JSON.stringify(poster)})` } : undefined}>
        {!poster && <div className="card-poster-bg" />}
        {item.rating ? (
          <div className="card-rating">
            <span className="star">★</span>
            {String(item.rating)}
          </div>
        ) : null}
        <div className="card-kind">{isSeries(item) ? "Series" : "Movie"}</div>
        <div className="card-overlay" />
        <div className="card-info">
          <div className="card-play">▶</div>
          <div className="card-title">{item.title || "Unknown"}</div>
          {overlayMeta && <div className="card-meta">{overlayMeta}</div>}
          {genre && <div className="card-genre">{genre}</div>}
        </div>
      </div>
      <div className="card-body">
        <div className="card-body-title">{item.title || "Unknown"}</div>
        {meta && <div className="card-body-meta">{meta}</div>}
      </div>
    </AppLink>
  );
}

function LoadingSkeleton(): JSX.Element {
  return (
    <div style={{ marginBottom: 52 }}>
      <div
        style={{
          width: 220,
          height: 28,
          background: "var(--surface)",
          borderRadius: 3,
          marginBottom: 20,
          animation: "pulse--catalog 1.5s infinite",
        }}
      />
      <div className="loading-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <div className="skeleton" key={i}>
            <div className="skeleton-poster" />
            <div className="skeleton-body" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CatalogPage(): JSX.Element {
  usePageScope("catalog", "Streamio - Catalog");
  useLoadPreferences();

  // What the catalogue contains depends on who is asking (18+ preference).
  const sessionReady = useQuietSession();
  const query = usePublicQuery<{ data?: HomeCategory[] }>(sessionReady ? withProvider("/api/home") : null);
  const carousel = useRef<HTMLDivElement>(null);

  const categories = query.data?.data ?? [];
  const featured = categories.find((c) => isFeaturedCategory(c.name));
  const regular = categories.filter((c) => !isFeaturedCategory(c.name));

  let content: JSX.Element | JSX.Element[];
  if (query.isError) {
    content = <div className="empty">Error loading catalog: {query.error.message}</div>;
  } else if (!query.data) {
    content = <LoadingSkeleton />;
  } else if (!categories.length) {
    content = <div className="empty">No categories available for this provider.</div>;
  } else {
    const grids = regular
      .filter((c) => c.list?.length)
      .map((category, i) => (
        <div className="category" key={`${category.name}-${i}`}>
          <div className="category-header">
            <h2 className="category-title">{category.name || "Unnamed"}</h2>
            <span className="category-count">{category.list?.length}</span>
          </div>
          <div className="grid">
            {category.list?.map((item, j) => <Card key={`${item.id}-${j}`} item={item} />)}
          </div>
        </div>
      ));
    content = grids.length ? grids : <div className="empty">No items found.</div>;
  }

  const scrollCarousel = (dir: number) => carousel.current?.scrollBy({ left: dir * 300, behavior: "smooth" });

  return (
    <>
      <TopNav active="catalog" />

      <div className="page-wrap">
        <div className="page-hero">
          <h1>Catalog</h1>
          <p>Browse content from your active streaming provider</p>
        </div>

        {featured?.list?.length ? (
          <div className="featured-section" id="featuredSection" style={{ display: "block" }}>
            <div className="featured-label">In evidenza</div>
            <div className="featured-header">
              <h2 id="featuredTitle">{featured.name}</h2>
            </div>
            <div className="carousel-wrap">
              <button className="carousel-btn prev" onClick={() => scrollCarousel(-3)}>
                &#8249;
              </button>
              <div className="carousel" id="featuredCarousel" ref={carousel}>
                {featured.list.map((item, j) => (
                  <FeatCard key={`${item.id}-${j}`} item={item} />
                ))}
              </div>
              <button className="carousel-btn next" onClick={() => scrollCarousel(3)}>
                &#8250;
              </button>
            </div>
          </div>
        ) : null}

        <div className="catalog" id="catalogContent">
          {content}
        </div>
      </div>

      <BottomNav active="catalog" />
    </>
  );
}
