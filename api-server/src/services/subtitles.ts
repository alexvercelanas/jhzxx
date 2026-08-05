/**
 * Subtitle service — fetches real subtitles from OpenSubtitles public REST API.
 * Uses the TMDB API to resolve TMDB IDs → IMDb IDs first.
 *
 * OpenSubtitles REST API: https://rest.opensubtitles.org/search/imdbid-{id}
 * No API key required; just a custom User-Agent.
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';
const OS_BASE   = 'https://rest.opensubtitles.org/search';
const OS_UA     = 'CinePro v1.0';

// Languages to fetch (in priority order)
const LANGUAGES = ['eng', 'spa', 'fra', 'por', 'ara', 'deu', 'ita', 'zho', 'jpn', 'kor', 'rus', 'tur', 'pol', 'nld'];

export interface SubtitleResult {
    url: string;
    label: string;
    format: 'srt' | 'vtt';
}

interface OsEntry {
    SubLanguageID: string;
    LanguageName:  string;
    SubDownloadLink: string;
    SubFormat?: string;
    SubRating?: string;
    ISO639?: string;
}

// ── TMDB external ID lookup ───────────────────────────────────────────────────

async function getImdbId(tmdbId: number, type: 'movie' | 'tv', apiKey: string): Promise<string | null> {
    try {
        const url = `${TMDB_BASE}/${type}/${tmdbId}/external_ids?api_key=${apiKey}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json() as { imdb_id?: string | null };
        return data.imdb_id ?? null;
    } catch {
        return null;
    }
}

// ── OpenSubtitles REST API ────────────────────────────────────────────────────

async function searchOpenSubtitles(
    imdbId: string,          // e.g. "tt4154756"
    season?: number,
    episode?: number,
): Promise<OsEntry[]> {
    // Strip "tt" prefix — OS wants a plain number
    const id = imdbId.replace(/^tt/, '');

    let path = `/imdbid-${id}`;
    if (season !== undefined && episode !== undefined) {
        path += `/season-${season}/episode-${episode}`;
    }

    try {
        const res = await fetch(`${OS_BASE}${path}`, {
            headers: {
                'X-User-Agent': OS_UA,
                'Accept': 'application/json',
            },
        });
        if (!res.ok) return [];
        return await res.json() as OsEntry[];
    } catch {
        return [];
    }
}

// Pick the best entry per language (highest SubRating first)
function pickBestPerLanguage(entries: OsEntry[]): OsEntry[] {
    const byLang = new Map<string, OsEntry>();
    for (const e of entries) {
        const lang = e.SubLanguageID;
        const existing = byLang.get(lang);
        if (!existing || Number(e.SubRating ?? 0) > Number(existing.SubRating ?? 0)) {
            byLang.set(lang, e);
        }
    }
    // Return in the priority-language order
    const result: OsEntry[] = [];
    for (const lang of LANGUAGES) {
        const entry = byLang.get(lang);
        if (entry) result.push(entry);
    }
    // Append any remaining languages not in priority list
    for (const [lang, entry] of byLang) {
        if (!LANGUAGES.includes(lang)) result.push(entry);
    }
    return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function fetchMovieSubtitles(
    tmdbId: number,
    tmdbApiKey: string,
    proxyBaseUrl: string,
): Promise<SubtitleResult[]> {
    const imdbId = await getImdbId(tmdbId, 'movie', tmdbApiKey);
    if (!imdbId) return [];

    const entries = await searchOpenSubtitles(imdbId);
    return formatResults(pickBestPerLanguage(entries), proxyBaseUrl);
}

export async function fetchTVSubtitles(
    tmdbId: number,
    season: number,
    episode: number,
    tmdbApiKey: string,
    proxyBaseUrl: string,
): Promise<SubtitleResult[]> {
    const imdbId = await getImdbId(tmdbId, 'tv', tmdbApiKey);
    if (!imdbId) return [];

    const entries = await searchOpenSubtitles(imdbId, season, episode);
    return formatResults(pickBestPerLanguage(entries), proxyBaseUrl);
}

function formatResults(entries: OsEntry[], proxyBaseUrl: string): SubtitleResult[] {
    return entries.map((e) => {
        // Proxy the download through our server so CORS/auth headers are handled
        const data = JSON.stringify({ url: e.SubDownloadLink, headers: { 'X-User-Agent': OS_UA } });
        const proxiedUrl = `${proxyBaseUrl}/v1/proxy?data=${encodeURIComponent(data)}`;
        return {
            url: proxiedUrl,
            label: e.LanguageName,
            format: (e.SubFormat?.toLowerCase() === 'vtt' ? 'vtt' : 'srt') as 'srt' | 'vtt',
        };
    });
}
