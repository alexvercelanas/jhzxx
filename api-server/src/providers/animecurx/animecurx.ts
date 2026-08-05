import { BaseProvider } from '@omss/framework';
import type { ProviderCapabilities, ProviderMediaObject, ProviderResult } from '@omss/framework';

interface AnimeCurxStream {
    index: number;
    label: string;
    url: string;
}

export class AnimeCurxProvider extends BaseProvider {
    readonly id = 'animecurx';
    readonly name = 'AnimeCurx';
    // Disabled for the default movie/TV path: this upstream is currently
    // unreliable and adds avoidable latency before the reliable provider
    // response is returned. It can be re-enabled when the upstream recovers.
    readonly enabled = false;
    readonly BASE_URL = 'https://embed.animecurx.tech';

    readonly HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
        'Referer': 'https://embed.animecurx.tech/',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    };

    readonly capabilities: ProviderCapabilities = {
        supportedContentTypes: ['movies', 'tv'],
    };
    // AnimeCurx is currently slow/unreliable for movie and TV lookups. Keep it
    // available as a fallback, but never let it hold the entire source response
    // open while faster providers have already found playable streams.
    readonly REQUEST_TIMEOUT_MS = 1500;

    async getMovieSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.getSources(`${this.BASE_URL}/embed/movie/${media.tmdbId}`, media);
    }

    async getTVSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.getSources(
            `${this.BASE_URL}/embed/tv/${media.tmdbId}/${media.s}/${media.e}`,
            media
        );
    }

    private async getSources(url: string, media: ProviderMediaObject): Promise<ProviderResult> {
        try {
            const res = await fetch(url, {
                headers: this.HEADERS,
                signal: AbortSignal.timeout(this.REQUEST_TIMEOUT_MS),
            });
            if (!res.ok) {
                return this.emptyResult(`Embed page returned HTTP ${res.status}`, media);
            }

            const html = await res.text();

            // Extract: var streams = [{...}, ...];
            const match = html.match(/var\s+streams\s*=\s*(\[[\s\S]*?\]);/);
            if (!match) {
                return this.emptyResult('No streams variable found in embed page', media);
            }

            let streams: AnimeCurxStream[];
            try {
                streams = JSON.parse(match[1]);
            } catch {
                return this.emptyResult('Failed to parse streams JSON', media);
            }

            if (!streams.length) {
                return this.emptyResult('Streams array is empty', media);
            }

            const proxyHeaders = {
                'User-Agent': this.HEADERS['User-Agent'],
                'Referer': this.BASE_URL + '/',
            };

            const sources: ProviderResult['sources'] = streams.map((s) => ({
                // createProxyUrl → cleanThirdPartyProxy → our embed.animecurx.tech pattern
                // captures the FULL animecurx URL as group 1, preserving the wrapper.
                // OMSS proxy then fetches through animecurx for all manifests and segments.
                url: this.createProxyUrl(s.url, proxyHeaders),
                type: 'hls' as const,
                quality: s.label ?? `Source ${s.index + 1}`,
                audioTracks: [{ label: 'English', language: 'eng' }],
                provider: { id: this.id, name: this.name },
            }));

            return { sources, subtitles: [], diagnostics: [] };
        } catch (error) {
            return this.emptyResult(
                error instanceof Error ? error.message : 'Unknown error',
                media
            );
        }
    }

    private emptyResult(message: string, _media: ProviderMediaObject): ProviderResult {
        return {
            sources: [],
            subtitles: [],
            diagnostics: [{ code: 'PROVIDER_ERROR', message: `${this.name}: ${message}`, field: '', severity: 'error' }],
        };
    }

    async healthCheck(): Promise<boolean> {
        try {
            const res = await fetch(this.BASE_URL, { method: 'HEAD', headers: this.HEADERS });
            return res.status < 500;
        } catch {
            return false;
        }
    }
}
