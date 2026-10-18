/**
 * The server's own domain types, as they arrive over the wire.
 *
 * Imported from the backend's emitted declarations (dist/, see tsconfig
 * `paths`) rather than redefined, so a field added to a model shows up here
 * without a second copy to keep in step. `import type` only: nothing from
 * the server reaches the bundle.
 */
import type { Movie } from "@server/core/models/Movie.js";
import type { TvShow } from "@server/core/models/TvShow.js";
import type { Episode } from "@server/core/models/Episode.js";
import type { Season } from "@server/core/models/Season.js";
import type { Genre } from "@server/core/models/Genre.js";
import type { ShowDetails } from "@server/core/models/ShowDetails.js";
import type { ProviderInfo } from "@server/core/core.js";

/**
 * A class instance after JSON.stringify/parse: methods gone, Dates as
 * strings, applied all the way down.
 */
export type Wire<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T as T[K] extends (...args: never[]) => unknown ? never : K]: Wire<T[K]> }
      : T;

export type WireMovie = Wire<Movie>;
export type WireTvShow = Wire<TvShow>;
export type WireShow = WireMovie | WireTvShow;
export type WireEpisode = Wire<Episode>;
export type WireSeason = Wire<Season>;
export type WireGenre = Wire<Genre>;
export type { ShowDetails, ProviderInfo };

/** `GET /api/providers`. */
export interface ProvidersResponse {
  catalog?: ProviderInfo[];
  providers?: string[];
  default?: string;
}

/**
 * A title as listings carry it (home rails, search results, genre pages):
 * the Movie/TvShow fields a card reads. Structural rather than WireShow, since
 * a listing may omit most of them and `seasons` is how a series is told apart.
 */
export interface ListItem {
  id: string;
  title?: string | null;
  poster?: string | null;
  banner?: string | null;
  rating?: number | null;
  overview?: string | null;
  runtime?: number | null;
  released?: string | null;
  quality?: string | null;
  genres?: { id?: string | number; name?: string | null }[] | null;
  seasons?: unknown[];
  details?: ShowDetails | null;
  adult?: boolean;
  providerName?: string | null;
}

/** A `GET /api/home` category. */
export interface HomeCategory {
  name: string;
  list?: ListItem[];
}
