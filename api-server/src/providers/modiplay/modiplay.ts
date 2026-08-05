// ModiPlay / StreamHG provider
//
// Source: rozgarlelo.modiplay.xyz — a StreamHG-based embed aggregator
// keyed by TMDB ID with multi-language audio (Hindi, English, Tamil, Telugu, …)
//
// Reverse-engineered pipeline
// ───────────────────────────
// 1. GET rozgarlelo.modiplay.xyz/embed/tmdb/movie?id={tmdbId}
//    → HTML contains `proxy.php?p=streamhg&c={file_code}` — parse the file_code.
//    The page is behind Cloudflare managed-challenge; this fetch works on
//    Cloudflare Workers (CF trusts its own infrastructure IPs) and in
//    non-CF environments that happened to pass the JS challenge.  Falls back
//    to empty result when blocked.
//
// 2. GET hanerix.com/e/{file_code}   (Referer: modiplay embed URL)
//    → Returns a Dean-Edwards-packed JW Player page. Decode to get:
//      var links = {
//        "hls4": "/stream/{token}/{salt}/{ts}/{file_id}/master.m3u8",  // relative
//        "hls2": "https://{cdn}/hls2/…/master.m3u8?t=…&e=…"           // CDN, 36h TTL
//      };
//
// 3. Resolve hls4 → https://hanerix.com/stream/…
//    Both URLs return a multi-rendition HLS manifest with separate audio tracks
//    (Hindi as default, English, Tamil, Telugu, …).

import { BaseProvider } from '@omss/framework';
import type { ProviderCapabilities, ProviderMediaObject, ProviderResult } from '@omss/framework';

const MODIPLAY_BASE = 'https://rozgarlelo.modiplay.xyz';
const HANERIX_BASE  = 'https://hanerix.com';

// ─── Packed JS decoder ────────────────────────────────────────────────────────

/**
 * Dean Edwards p,a,c,k,e,d unpacker.
 * Handles both the `e,r` and `e,d` variants.
 */
function unpackJs(p: string, a: number, c: number, k: string[]): string {
    function e(n: number): string {
        return (n < a ? '' : e(Math.floor(n / a))) +
               ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
    }
    const d: Record<string, string> = {};
    while (c--) if (k[c]) d[e(c)] = k[c];
    return p.replace(/\b\w+\b/g, (word) => d[word] ?? word);
}

function decodeFirstPackedBlock(html: string): string | null {
    const m = html.match(
        /eval\(function\(p,a,c,k,e,(?:r|d)\)\{[\s\S]+?\}\s*\(\s*'([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]+?)'\.split\('\|'\)/
    );
    if (!m) return null;
    try {
        return unpackJs(m[1], parseInt(m[2]), parseInt(m[3]), m[4].split('|'));
    } catch {
        return null;
    }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class ModiPlayProvider extends BaseProvider {
    readonly id    = 'modiplay';
    readonly name  = 'ModiPlay';
    readonly enabled = true;
    readonly BASE_URL = 'https://rozgarlelo.modiplay.xyz';
    readonly capabilities: ProviderCapabilities = {
        supportedContentTypes: ['movies', 'tv'],
    };

    /** Browser-like headers — satisfies the BaseProvider abstract HEADERS contract
     *  and passed on every outbound fetch to modiplay / hanerix. */
    readonly HEADERS: Record<string, string> = {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control':   'no-cache',
        'Pragma':          'no-cache',
        'Sec-Fetch-Dest':  'iframe',
        'Sec-Fetch-Mode':  'navigate',
        'Sec-Fetch-Site':  'cross-site',
    };

    async getMovieSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this._getSources(media, 'movie');
    }
    async getTVSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this._getSources(media, 'tv');
    }

    private async _getSources(
        media: ProviderMediaObject,
        type: 'movie' | 'tv'
    ): Promise<ProviderResult> {
        try {
            const embedUrl = type === 'movie'
                ? `${MODIPLAY_BASE}/embed/tmdb/movie?id=${media.tmdbId}`
                : `${MODIPLAY_BASE}/embed/tmdb/tv?id=${media.tmdbId}&s=${media.s}&e=${media.e}`;

            // Step 1 — get file_code from modiplay embed
            const fileCode = await this._getFileCode(embedUrl);
            if (!fileCode) {
                return this._empty(
                    'Cloudflare challenge blocked the modiplay embed page — ' +
                    'this provider works best on Cloudflare Workers deployments',
                    media
                );
            }

            // Step 2 — extract HLS streams from hanerix embed
            const sources = await this._extractStreams(fileCode, embedUrl);
            if (!sources.length) {
                return this._empty('No streams found in hanerix embed page', media);
            }

            return { sources, subtitles: [], diagnostics: [] };
        } catch (err) {
            return this._empty(err instanceof Error ? err.message : String(err), media);
        }
    }

    /** Fetch the modiplay embed page and parse the StreamHG file_code out of it. */
    private async _getFileCode(embedUrl: string): Promise<string | null> {
        let res: Response;
        try {
            res = await fetch(embedUrl, {
                headers: { ...this.HEADERS },
                signal: AbortSignal.timeout(12_000),
            });
        } catch {
            return null;
        }
        if (!res.ok) return null;

        const html = await res.text();

        // The embed page contains something like:
        //   proxy.php?p=streamhg&c=iu78v08rkv39&title=...
        const m = html.match(/proxy\.php\?p=streamhg&(?:amp;)?c=([a-z0-9]+)/i);
        return m?.[1] ?? null;
    }

    /** Fetch the hanerix.com embed page and decode the packed JS to get stream URLs. */
    private async _extractStreams(
        fileCode: string,
        referer: string
    ): Promise<ProviderResult['sources']> {
        let res: Response;
        try {
            res = await fetch(`${HANERIX_BASE}/e/${fileCode}`, {
                headers: {
                    ...this.HEADERS,
                    Referer: referer,
                },
                signal: AbortSignal.timeout(12_000),
            });
        } catch {
            return [];
        }
        if (!res.ok) return [];

        const html    = await res.text();
        const decoded = decodeFirstPackedBlock(html);
        if (!decoded) return [];

        // var links={"hls4":"/stream/...","hls2":"https://..."}
        const linksJson = decoded.match(/var\s+links\s*=\s*(\{[^}]+\})/)?.[1];
        if (!linksJson) return [];

        const hls4raw = linksJson.match(/"hls4"\s*:\s*"([^"]+)"/)?.[1];
        const hls2raw = linksJson.match(/"hls2"\s*:\s*"([^"]+)"/)?.[1];

        const hls4abs = hls4raw
            ? (hls4raw.startsWith('http') ? hls4raw : `${HANERIX_BASE}${hls4raw}`)
            : undefined;

        const proxyHdrs = {
            'User-Agent': this.HEADERS['User-Agent'],
            'Referer':    `${HANERIX_BASE}/`,
        };

        // Multi-language audio tracks confirmed in the m3u8:
        //   Hindi (default), English, Tamil, Telugu
        const audioTracks = [
            { label: 'Hindi',   language: 'hin' },
            { label: 'English', language: 'eng' },
            { label: 'Tamil',   language: 'tam' },
            { label: 'Telugu',  language: 'tel' },
        ];

        const sources: ProviderResult['sources'] = [];

        if (hls4abs) {
            sources.push({
                url:         this.createProxyUrl(hls4abs, proxyHdrs),
                type:        'hls',
                quality:     'Multi-Lang',
                audioTracks,
                provider:    { id: this.id, name: this.name },
            });
        }
        if (hls2raw) {
            sources.push({
                url:         this.createProxyUrl(hls2raw, proxyHdrs),
                type:        'hls',
                quality:     'CDN',
                audioTracks,
                provider:    { id: this.id, name: this.name },
            });
        }

        return sources;
    }

    private _empty(message: string, _media: ProviderMediaObject): ProviderResult {
        return {
            sources:     [],
            subtitles:   [],
            diagnostics: [{
                code:     'PROVIDER_ERROR',
                message:  `${this.name}: ${message}`,
                field:    '',
                severity: 'error',
            }],
        };
    }

    async healthCheck(): Promise<boolean> {
        try {
            const r = await fetch(`${HANERIX_BASE}/`, {
                method: 'HEAD',
                signal: AbortSignal.timeout(5_000),
            });
            return r.status < 500;
        } catch { return false; }
    }
}
