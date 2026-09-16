import { AppAdapter, AppItem, ItemType } from '../adapters/AppAdapter.js';
import { Category, Genre } from './index.js';

type VideoServer = { id: string; name: string; src: string };

/**
 * Genre browsing, implemented by every provider whose upstream site exposes a
 * genre/category filter.
 *
 * Kept as a structural interface rather than methods on `Provider` because
 * `Core` has to be able to tell a provider that supports genres from one that
 * doesn't: base-class stubs that throw would make `typeof p.getGenres ===
 * "function"` true for everyone, and the caller would learn the provider can't
 * do it only from an exception.
 */
export interface GenreCapableProvider {
    /** The provider's genre catalogue — `{ id, name }`, no shows attached. */
    getGenres(): Promise<Genre[]>;
    /** One page of titles in a genre, returned on the `Genre`'s `shows`. */
    getGenre(id: string, page: number): Promise<Genre>;
}

export function supportsGenres(
    provider: Provider
): provider is Provider & GenreCapableProvider {
    const candidate = provider as Partial<GenreCapableProvider>;
    return (
        typeof candidate.getGenres === "function" &&
        typeof candidate.getGenre === "function"
    );
}

/**
 * Maps a playable id — an episode, a season, a movie — back to the id of the
 * title it belongs to.
 *
 * Exists so the 18+ gate can be enforced where content actually becomes
 * viewable. `/shows/:id` can check the flag on the title it just fetched, but
 * `/episodes/:id/servers` and `/episodes/:id/video` only ever see an id one
 * level down, and used to resolve it without asking: anyone holding a gated
 * episode id could still stream it whatever their preference said.
 *
 * Structural, and for the same reason as `GenreCapableProvider`: a base-class
 * stub would make every provider look capable, and the caller has to be able
 * to tell "this source cannot map ids" from "this id has no parent" — the
 * first leaves the gate where it was, the second is a real answer.
 */
export interface PlayableOwnershipProvider {
    /** The owning show's id, or null if this id doesn't belong to one. */
    showIdForPlayableId(playableId: string): string | null;
}

export function supportsPlayableOwnership(
    provider: Provider
): provider is Provider & PlayableOwnershipProvider {
    return (
        typeof (provider as Partial<PlayableOwnershipProvider>)
            .showIdForPlayableId === "function"
    );
}

export class Provider implements AppItem {
    private readonly name: string;
    private logo: string;
    private readonly language: string;

    public itemType!: ItemType;

    constructor(
        name: string,
        logo: string,
        language: string,
    ) {
        this.name = name;
        this.logo = logo;
        this.language = language;
    }

    public setLogo(url: string) {
        this.logo = url;
    }

    public getLogo(): string {
        return this.logo;
    }

    public getName(): string {
        return this.name;
    }

    public getLanguage(): string {
        return this.language;
    }

    public async getHome(): Promise<Category[]> {
        throw new Error("Not implemented");
    }

    public async search(query: string, page: number): Promise<AppItem[]> {
        throw new Error("Not implemented");
    }

    public async getMovie(id: string): Promise<AppItem> {
        throw new Error("Not implemented");
    }

    public async getTvShow(id: string): Promise<AppItem> {
        throw new Error("Not implemented");
    }

    public async getEpisodesBySeason(seasonId: string): Promise<AppItem[]> {
        throw new Error("Not implemented");
    }

    public async getServers(id: string): Promise<VideoServer[]> {
        throw new Error("Not implemented");
    }

    public equals(other: any): boolean {
        if (other instanceof Provider) {
            return this.name === other.name;
        }
        return false;
    }

    public toString(): string {
        return `${this.name}`;
    }
}