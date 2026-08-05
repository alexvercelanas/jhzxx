import { BaseProvider } from '@omss/framework';
import type { ProviderCapabilities, ProviderMediaObject, ProviderResult } from '@omss/framework';

/**
 * MegaPlay ("E1/E2" server used by HiAnime and friends) serves anime episodes
 * keyed by AniList ID + episode number + audio track (sub|dub) — not TMDB IDs,
 * so it doesn't fit the OMSS movies/tv pipeline. It is intentionally kept out of
 * `providers/` (not auto-discovered by the registry) and wired up as its own
 * `/v1/anime/:anilistId/:episode/:audio` route in server.ts instead.
 *
 * Flow (reverse-engineered from megaplay.buzz's embed page + app.main.js):
 *  1. GET /stream/ani/{anilistId}/{episode}/{sub|dub} — this 410s unless a
 *     Referer from an allowed partner domain (e.g. hianime.to) is sent. The
 *     HTML embeds a numeric `data-id` on `#megaplay-player`, which is the
 *     internal file id (different from the AniList id / episode in the URL).
 *  2. GET /stream/getSources?id={data-id} — 403s ("accepts only AJAX
 *     requests") unless `X-Requested-With: XMLHttpRequest` is sent. Returns
 *     `{ sources: { file }, tracks: [...] }` where `file` is an HLS manifest
 *     and tracks are VTT subtitles.
 *  3. The CDN serving the manifest/segments/subtitles (mewstream.buzz,
 *     lostproject.club, etc.) requires a `Referer: https://megaplay.buzz/`
 *     header on every request — the opposite of VidRift, which 403s if a
 *     Referer is present at all. Always send it for MegaPlay.
 */
const STREAM_REFERER = 'https://hianime.to/';
const CDN_REFERER = 'https://megaplay.buzz/';
const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36';

interface MegaplaySourcesResponse {
    sources?: { file?: string };
    tracks?: Array<{ file?: string; label?: string; kind?: string; default?: boolean }>;
}

export type MegaplayAudio = 'sub' | 'dub';

export class MegaplayProvider extends BaseProvider {
    readonly id = 'megaplay';
    readonly name = 'MegaPlay';
    readonly enabled = true;
    readonly BASE_URL = 'https://megaplay.buzz';
    readonly HEADERS = {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
    };

    // Doesn't fit 'movies' | 'tv' | 'sub' — this provider is anime-only and
    // reached through its own route, not the OMSS content pipeline.
    readonly capabilities: ProviderCapabilities = { supportedContentTypes: [] };

    // Required by BaseProvider but unused — MegaPlay is never registered
    // with the provider registry, so these are never actually called.
    async getMovieSources(_media: ProviderMediaObject): Promise<ProviderResult> {
        return { sources: [], subtitles: [], diagnostics: [] };
    }
    async getTVSources(_media: ProviderMediaObject): Promise<ProviderResult> {
        return { sources: [], subtitles: [], diagnostics: [] };
    }

    async getAnimeSources(anilistId: string, episode: string, audio: MegaplayAudio): Promise<ProviderResult> {
        try {
            const streamUrl = `${this.BASE_URL}/stream/ani/${anilistId}/${episode}/${audio}`;
            const embedRes = await fetch(streamUrl, {
                headers: { ...this.HEADERS, Referer: STREAM_REFERER },
            });
            if (!embedRes.ok) throw new Error(`Embed page returned ${embedRes.status}`);

            const html = await embedRes.text();
            const idMatch = html.match(/data-id="(\d+)"/);
            if (!idMatch) throw new Error('No episode found for this AniList ID / episode / audio combination');
            const fileId = idMatch[1];

            const sourcesRes = await fetch(`${this.BASE_URL}/stream/getSources?id=${fileId}`, {
                headers: {
                    ...this.HEADERS,
                    Referer: streamUrl,
                    'X-Requested-With': 'XMLHttpRequest',
                },
            });
            if (!sourcesRes.ok) throw new Error(`getSources returned ${sourcesRes.status}`);

            const data = (await sourcesRes.json()) as MegaplaySourcesResponse;
            const file = data.sources?.file;
            if (!file) throw new Error('No stream file in getSources response');

            const cdnHeaders = { 'User-Agent': USER_AGENT, Referer: CDN_REFERER };

            const sources: ProviderResult['sources'] = [
                {
                    url: this.createProxyUrl(file, cdnHeaders),
                    type: 'hls',
                    quality: 'Auto',
                    audioTracks: [
                        audio === 'dub'
                            ? { label: 'English', language: 'eng' }
                            : { label: 'Japanese', language: 'jpn' },
                    ],
                    provider: { id: this.id, name: this.name },
                },
            ];

            const subtitles: ProviderResult['subtitles'] = (data.tracks ?? [])
                .filter((t) => t.kind === 'captions' && !!t.file)
                .map((t) => ({
                    url: this.createProxyUrl(t.file as string, cdnHeaders),
                    label: t.label ?? 'English',
                    format: 'vtt' as const,
                }));

            return { sources, subtitles, diagnostics: [] };
        } catch (error) {
            return {
                sources: [],
                subtitles: [],
                diagnostics: [
                    {
                        code: 'PROVIDER_ERROR',
                        message: `${this.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        field: '',
                        severity: 'error',
                    },
                ],
            };
        }
    }

    async healthCheck(): Promise<boolean> {
        try {
            return (await fetch(this.BASE_URL, { method: 'HEAD', headers: this.HEADERS })).status < 500;
        } catch {
            return false;
        }
    }
}
