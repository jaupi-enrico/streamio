import { Core } from "../core.js";
import type { Database } from "../../database/db.js";
export class PlatformHandler {
    protected platform: string | null = null;
    protected core: Core;

    // `db` is optional because most callers of `Core` have never had to supply
    // one: only a source backed by this server's own tables needs it — see
    // core/core.ts's constructor.
    constructor(platform: string, db?: Database) {
        this.platform = platform;
        this.core = new Core(db);
    }

    getDefaultProvider() {
        return this.core.getDefaultProvider();
    }

    getDefaultProviderName() {
        return this.core.getDefaultProviderName();
    }

    getListOfProviders(openGates: ReadonlySet<string> = new Set()) {
        return this.core.getListOfProviders(openGates);
    }

    getProviderCatalog(openGates: ReadonlySet<string> = new Set()) {
        return this.core.getProviderCatalog(openGates);
    }

    isAdultProvider(name: string) {
        return this.core.isAdultProvider(name);
    }

    adultGatesFor(name: string) {
        return this.core.adultGatesFor(name);
    }

    getProviderByName(name: string) {
        return this.core.getProviderByName(name);
    }

    getAdminProviderCatalog() {
        return this.core.getAdminProviderCatalog();
    }

    setProviderDisabled(slug: string, disabled: boolean) {
        return this.core.setProviderDisabled(slug, disabled);
    }

    isProviderDisabled(slug: string) {
        return this.core.isProviderDisabled(slug);
    }

    applyDisabledProviders(slugs: string[]) {
        return this.core.loadDisabledProviders(slugs);
    }

    getHome(providerName: string) {
    // Implementation for getting home content
    }

    search(providerName: string, query: string, page?: number) {
        // Implementation for searching content
    }
    getShowDetails(providerName: string, showId: string) {
        // Implementation for getting show details
    }
    getEpisodes(providerName: string, seasonId: string) {
        // Implementation for getting episodes
    }
    getServers(providerName: string, episodeId: string, contentType?: "episode" | "movie") {
        // Implementation for getting servers
    }
    
}