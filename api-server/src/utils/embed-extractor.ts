/**
 * Shared utilities for scraping stream URLs out of embed HTML pages.
 * Covers the most common patterns seen across iframe-based embed providers.
 */

export interface ExtractedStream {
    url: string;
    type: 'hls' | 'mp4';
}

const HLS_PATTERNS: RegExp[] = [
    /"(?:file|src|stream|source|hls|playlist|streamUrl|playbackUrl|url)"\s*:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/gi,
    /(?:file|src|stream|source|hls|playlist)\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/gi,
    /<source[^>]+src=["'](https?:\/\/[^"']+\.m3u8[^"']*)/gi,
    /https?:\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?/gi,
];

const MP4_PATTERNS: RegExp[] = [
    /"(?:file|src|stream|source|mp4|url)"\s*:\s*"(https?:\/\/[^"]+\.mp4[^"]*)"/gi,
    /(?:file|src|stream|source|mp4)\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)/gi,
    /<source[^>]+src=["'](https?:\/\/[^"']+\.mp4[^"']*)/gi,
];

/**
 * Extracts all unique HLS/MP4 stream URLs found in HTML/JS text.
 * HLS is returned first (preferred by the player's sort logic).
 */
export function extractStreamUrls(html: string): ExtractedStream[] {
    const seen = new Set<string>();
    const results: ExtractedStream[] = [];

    for (const pattern of HLS_PATTERNS) {
        for (const match of html.matchAll(pattern)) {
            const url = match[1] ?? match[0];
            if (url && !seen.has(url) && url.includes('.m3u8')) {
                seen.add(url);
                results.push({ url, type: 'hls' });
            }
        }
    }

    for (const pattern of MP4_PATTERNS) {
        for (const match of html.matchAll(pattern)) {
            const url = match[1] ?? match[0];
            if (url && !seen.has(url) && url.includes('.mp4')) {
                seen.add(url);
                results.push({ url, type: 'mp4' });
            }
        }
    }

    return results;
}

/**
 * Extracts the first `src` attribute of an <iframe> in HTML.
 */
export function extractIframeSrc(html: string): string | null {
    const match = html.match(/<iframe[^>]+\ssrc=["']([^"']+)["']/i);
    return match ? match[1] : null;
}

/**
 * Resolve a potentially protocol-relative or relative URL against a base.
 */
export function resolveUrl(url: string, base: string): string {
    if (url.startsWith('//')) return 'https:' + url;
    try {
        return new URL(url, base).href;
    } catch {
        return url;
    }
}
