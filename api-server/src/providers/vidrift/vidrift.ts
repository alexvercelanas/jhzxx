import { BaseProvider } from '@omss/framework';
import type { ProviderCapabilities, ProviderMediaObject, ProviderResult } from '@omss/framework';

const SUB_BASE = 'https://sub.1x2.space';

interface Sub1x2Entry {
    label: string;
    language: string;
    status: string;   // 'cached' | 'failed'
    url: string;      // relative path, e.g. /subtitle/movie/123/English.vtt
    size?: number;
}

/**
 * VidRift's embed page protects its source API with a short-lived signed
 * token: `${unixSeconds}-${hash(unixSeconds + ':' + VR_SECRET)}` where hash
 * is a simple 32-bit rolling hash rendered as base36. Reverse-engineered
 * from the embed page's inline script.
 */
const VR_SECRET = 'vr_sec_v2_9kL8mN4qR2tX';
// 'ngcf' and 'vidlink' are currently dead on vidrift's end (persistent Cloudflare 502s from
// origin overload) and firing them in parallel with 'embed' slows every request down and can
// trip vidrift's rate limiting. Only 'embed' is reliable, so we use it exclusively for speed.
const VR_SOURCES = ['embed'] as const;

interface VidRiftStream {
    index: number;
    url: string;
    proxyUrl?: string;
    label?: string;
    quality?: string;
}

interface VidRiftSourceResponse {
    success: boolean;
    sourceType?: 'hls' | 'mp4';
    streams?: VidRiftStream[];
}


function vrHash(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h << 5) - h + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h).toString(36).padStart(8, '0');
}

function vrToken(): string {
    const t = Math.floor(Date.now() / 1000);
    return `${t}-${vrHash(`${t}:${VR_SECRET}`)}`;
}

export class VidRiftProvider extends BaseProvider {
    readonly id = 'vidrift';
    readonly name = 'VidRift';
    readonly enabled = true;
    readonly BASE_URL = 'https://vidrift.in';
    // No Referer here on purpose: vidrift's CDN (remoteconsultinggroup.site and friends) returns
    // 403 on segment/content requests ("/content/.../page-N.html") specifically when a Referer
    // header is present, regardless of its value. The API endpoint and manifest requests work
    // fine without it too, so we drop it everywhere rather than special-casing per request type.
    readonly HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
        Accept: 'application/json, text/html, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
    };

    readonly capabilities: ProviderCapabilities = { supportedContentTypes: ['movies', 'tv'] };

    async getMovieSources(media: ProviderMediaObject): Promise<ProviderResult> { return this.getSources(media); }
    async getTVSources(media: ProviderMediaObject): Promise<ProviderResult> { return this.getSources(media); }

    private async getSources(media: ProviderMediaObject): Promise<ProviderResult> {
        try {
            const headers = { ...this.HEADERS };

            // Fetch streams and subtitles in parallel — subtitles come from
            // sub.1x2.space regardless of whether streams succeed.
            const [streamResults, subtitles] = await Promise.all([
                Promise.allSettled(
                    VR_SOURCES.map((src) => this.fetchSource(media, src, headers))
                ),
                this.fetchSubtitlesFrom1x2(media),
            ]);

            const sources: ProviderResult['sources'] = [];
            for (const result of streamResults) {
                if (result.status === 'fulfilled' && result.value) {
                    sources.push(...result.value);
                }
            }

            if (sources.length === 0 && subtitles.length === 0) {
                throw new Error('No streams returned by any source');
            }

            return { sources, subtitles, diagnostics: [] };
        } catch (error) {
            return this.emptyResult(error instanceof Error ? error.message : 'Unknown error', media);
        }
    }

    private async fetchSource(
        media: ProviderMediaObject,
        source: string,
        headers: Record<string, string>
    ): Promise<ProviderResult['sources'] | null> {
        const token = vrToken();
        const path = media.type === 'movie'
            ? `/api/source/movie/${media.tmdbId}?_t=${token}&source=${source}`
            : `/api/source/tv/${media.tmdbId}/${media.s}/${media.e}?_t=${token}&source=${source}`;

        const res = await fetch(`${this.BASE_URL}${path}`, { headers });
        if (!res.ok) return null;

        const data = await res.json() as VidRiftSourceResponse;
        if (!data.success || !data.streams?.length) return null;

        const type: 'hls' | 'mp4' = data.sourceType === 'mp4' ? 'mp4' : 'hls';

        return data.streams.map((s) => ({
            // The OMSS framework requires source URLs to be in its own /v1/proxy?data= format
            // (it validates and, for HLS, rewrites manifests through this endpoint) — a raw
            // upstream URL gets silently dropped. So we keep the wrap, but only for the single
            // reliable 'embed' source (see VR_SOURCES above), which cuts request overhead vs.
            // hitting all 3 sources including the two that are currently dead upstream.
            url: this.createProxyUrl(s.url, headers),
            type,
            quality: s.label ?? s.quality ?? 'Auto',
            audioTracks: [{ label: 'English', language: 'eng' }],
            provider: { id: this.id, name: this.name },
        }));
    }

    /**
     * Fetches subtitles from sub.1x2.space — a TMDB-keyed subtitle API used
     * by play.xpass.top. Returns VTT files served with open CORS (no proxy needed).
     *
     * Movie:  GET https://sub.1x2.space/api/movie/{tmdbId}
     * TV:     GET https://sub.1x2.space/api/tv/{tmdbId}/{season}/{episode}
     *
     * Response: [{label, language, status, url}] where url is a relative path
     * like /subtitle/movie/123/English.vtt. Only entries with status "cached"
     * have a real file; "failed" entries should be skipped.
     */
    private async fetchSubtitlesFrom1x2(
        media: ProviderMediaObject,
    ): Promise<ProviderResult['subtitles']> {
        try {
            const path = media.type === 'movie'
                ? `/api/movie/${media.tmdbId}`
                : `/api/tv/${media.tmdbId}/${media.s}/${media.e}`;

            const res = await fetch(`${SUB_BASE}${path}`, {
                headers: { 'User-Agent': this.HEADERS['User-Agent'] },
            });
            if (!res.ok) return [];

            const entries = await res.json() as Sub1x2Entry[];
            if (!Array.isArray(entries) || !entries.length) return [];

            return entries
                .filter((e) => e.status === 'cached' && e.url)
                .map((e) => ({
                    // VTT served with access-control-allow-origin: * — use direct URL
                    url: `${SUB_BASE}${e.url}`,
                    label: e.label,
                    format: 'vtt' as const,
                }));
        } catch {
            return [];
        }
    }

    private emptyResult(message: string, _media: ProviderMediaObject): ProviderResult {
        return { sources: [], subtitles: [], diagnostics: [{ code: 'PROVIDER_ERROR', message: `${this.name}: ${message}`, field: '', severity: 'error' }] };
    }

    async healthCheck(): Promise<boolean> {
        try { return (await fetch(this.BASE_URL, { method: 'HEAD', headers: this.HEADERS })).status < 500; } catch { return false; }
    }
}
