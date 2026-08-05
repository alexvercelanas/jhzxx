/**
 * Shared resolver for the play.xpass.top JWPlayer backend. Several embed
 * sites (VidPass directly, and 2Embed/EmbedCC via a redirect chain) all
 * terminate at this same backend, which exposes a `var backups=[...]`
 * array of playlist.json endpoints on its embed page.
 */

export interface XPassBackup { id: string; name: string; url: string; dl?: boolean }
interface XPassPlaylistSource { file: string; type?: string; label?: string }
interface XPassPlaylistEntry { sources?: XPassPlaylistSource[] }
export interface XPassSource {
    url: string;
    type: 'hls' | 'mp4';
    quality: string;
}

const XPASS_BASE = 'https://play.xpass.top';

export function inferXpassType(type: string | undefined, url: string): 'hls' | 'mp4' {
    if (type === 'hls' || url.includes('.m3u8')) return 'hls';
    return 'mp4';
}

export async function fetchXpassEmbedHtml(
    embedUrl: string,
    headers: Record<string, string>
): Promise<string | null> {
    try {
        const res = await fetch(embedUrl, { headers: { ...headers, Referer: embedUrl }, signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        return await res.text();
    } catch {
        return null;
    }
}

export function extractXpassBackups(html: string): XPassBackup[] {
    // The page does not reliably terminate this statement with a semicolon
    // (it's sometimes immediately followed by `</script>`), so a naive
    // `[...];` regex can over-match into unrelated later JS. Find the `[`
    // after the declaration and walk forward counting brackets instead.
    const start = html.search(/var backups\s*=\s*\[/);
    if (start === -1) return [];
    const bracketStart = html.indexOf('[', start);
    if (bracketStart === -1) return [];

    let depth = 0;
    let inString: '"' | "'" | null = null;
    let escaped = false;
    for (let i = bracketStart; i < html.length; i++) {
        const ch = html[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === inString) inString = null;
            continue;
        }
        if (ch === '"' || ch === "'") { inString = ch; continue; }
        if (ch === '[') depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0) {
                const raw = html.slice(bracketStart, i + 1);
                try {
                    return JSON.parse(raw);
                } catch {
                    return [];
                }
            }
        }
    }
    return [];
}

export async function resolveXpassSources(
    backups: XPassBackup[],
    embedUrl: string,
    headers: Record<string, string>,
    limit = 5
): Promise<XPassSource[]> {
    const candidates = backups.slice(0, limit);
    const results = await Promise.allSettled(
        candidates.map(async (b) => {
            const url = new URL(b.url, XPASS_BASE).toString();
            const res = await fetch(url, { headers: { ...headers, Referer: embedUrl }, signal: AbortSignal.timeout(8000) });
            if (!res.ok) return null;
            const data = await res.json() as { playlist?: XPassPlaylistEntry[] };
            const entry = data.playlist?.[0];
            if (!entry?.sources?.length) return null;
            return entry.sources
                .filter((s) => !!s.file)
                .map((s) => ({
                    url: s.file,
                    type: inferXpassType(s.type, s.file),
                    quality: s.label ?? b.name ?? 'Auto',
                }));
        })
    );

    const sources: XPassSource[] = [];
    for (const result of results) {
        if (result.status === 'fulfilled' && result.value) sources.push(...result.value);
    }
    return sources;
}
