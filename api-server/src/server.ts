import { OMSSServer } from '@omss/framework';
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { knownThirdPartyProxies } from './thirdPartyProxies.js';
import { streamPatterns } from './streamPatterns.js';
import { MegaplayProvider, type MegaplayAudio } from './anime/megaplay.js';
import { AnimeCurxProvider } from './providers/animecurx/animecurx.js';
import { ModiPlayProvider } from './providers/modiplay/modiplay.js';
import { VaPlayerProvider } from './providers/vaplayer/vaplayer.js';
import { VidRiftProvider } from './providers/vidrift/vidrift.js';
import { XPassProvider } from './providers/xpass/xpass.js';
import { createHmac } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    const server = new OMSSServer({
        name: 'CinePro',
        version: '1.0.0',

        // Network
        host: process.env.HOST ?? '0.0.0.0',
        port: Number(process.env.PORT ?? 3000),
        publicUrl: process.env.PUBLIC_URL ??
            (process.env.REPLIT_DEV_DOMAIN
                ? `https://${process.env.REPLIT_DEV_DOMAIN}`
                : undefined),

        // Cache (memory for dev, Redis for prod)
        cache: {
            type: (process.env.CACHE_TYPE as 'memory' | 'redis') ?? 'memory',
            ttl: {
                sources: 60 * 60,
                subtitles: 60 * 60 * 24
            },
            redis: {
                host: process.env.REDIS_HOST ?? 'localhost',
                port: Number(process.env.REDIS_PORT ?? 6379),
                password: process.env.REDIS_PASSWORD
            }
        },

        // TMDB
        tmdb: {
            apiKey: process.env.TMDB_API_KEY!,
            cacheTTL: 24 * 60 * 60 // 24h
        },

        // Third Party Proxy removal
        proxyConfig: {
            knownThirdPartyProxies: knownThirdPartyProxies,
            streamPatterns
        },

        cors: {
            origin: process.env.CORS_ORIGIN ?? '*',
            methods: ['GET', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization'],
            exposedHeaders: ['Content-Range', 'Accept-Ranges', 'ETag'],
            preflightContinue: false,
            optionsSuccessStatus: 204
        },

        stremio: {
            // exposes a stremio addon on /stremio/manifest.json
            enableNativeAddon: process.env.STREMIO_ADDON === 'true',
            // you can your own custom stremio addons as sources into cinepro.
            stremioAddons: []
            /*
            stremioAddons: [
                {
                    id: 'some-unique-id',
                    url: 'https://example.com/manifest.json',
                    enabled: true
                }
            ]
            */
        },

        // MCP for AI agents
        mcp: {
            enabled: process.env.MCP_ENABLED === 'true'
        }
    });

    // Register providers explicitly so they work in both dev and bundled prod builds
    const registry = server.getRegistry();
    registry.register(new AnimeCurxProvider());
    registry.register(new ModiPlayProvider());
    registry.register(new VaPlayerProvider());
    registry.register(new VidRiftProvider());
    registry.register(new XPassProvider());

    
    // Subtitle fallback: if all providers returned no subtitles, fetch directly
    // from sub.1x2.space so subtitles work even when VidRift is blocked (e.g. on Render).
    const SUB_BASE = 'https://sub.1x2.space';
    const SUB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    async function fetchFallbackSubtitles(tmdbId: string, type: 'movie' | 'tv', s?: string, e?: string) {
        try {
            const path = type === 'movie'
                ? `/api/movie/${tmdbId}`
                : `/api/tv/${tmdbId}/${s}/${e}`;
            const res = await fetch(`${SUB_BASE}${path}`, {
                headers: { 'User-Agent': SUB_UA },
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) return [];
            const entries = await res.json() as Array<{ label: string; status: string; url: string }>;
            if (!Array.isArray(entries)) return [];
            return entries
                .filter(e => e.status === 'cached' && e.url)
                .map(e => ({ url: `${SUB_BASE}${e.url}`, label: e.label, format: 'vtt' }));
        } catch {
            return [];
        }
    }
    const fastify = server.getInstance();
    // Hook into movie sources response
    fastify.addHook('onSend', async (request, _reply, payload) => {
        const url = request.url;
        // Match /v1/movies/:id and /v1/tv/:id/seasons/:s/episodes/:e
        const movieMatch = url.match(/^\/v1\/movies\/(\d+)/);
        const tvMatch = url.match(/^\/v1\/tv\/(\d+)\/seasons\/(\d+)\/episodes\/(\d+)/);
        if (!movieMatch && !tvMatch) return payload;
        if (typeof payload !== 'string') return payload;
        try {
            const data = JSON.parse(payload);
             if (!data) return payload;
            // Normalize missing subtitles field to empty array so the check below works
            if (!Array.isArray(data.subtitles)) data.subtitles = [];
            // Already have subtitles — nothing to do
            if (data.subtitles.length > 0) return payload;
            // Subtitles are empty — fetch from sub.1x2.space as fallback
            const subs = movieMatch
                ? await fetchFallbackSubtitles(movieMatch[1], 'movie')
                : await fetchFallbackSubtitles(tvMatch![1], 'tv', tvMatch![2], tvMatch![3]);
            if (subs.length === 0) return payload;
            data.subtitles = subs;
            return JSON.stringify(data);
        } catch {
            return payload;
        }
    });


    // Anime (AniList ID + episode + audio track) — not TMDB-keyed, so it's
    // wired up as its own route instead of going through the OMSS movies/tv
    // content pipeline (see src/anime/megaplay.ts for why).
    const megaplay = new MegaplayProvider();
    server.getInstance().get<{
        Params: { anilistId: string; episode: string; audio: string };
    }>('/v1/anime/:anilistId/:episode/:audio', async (request, reply) => {
        const { anilistId, episode, audio } = request.params;

        if (!/^\d+$/.test(anilistId)) {
            return reply.code(400).send({ error: { code: 'INVALID_PARAMETER', message: 'anilistId must be numeric' } });
        }
        if (!/^\d+$/.test(episode)) {
            return reply.code(400).send({ error: { code: 'INVALID_PARAMETER', message: 'episode must be numeric' } });
        }
        if (audio !== 'sub' && audio !== 'dub') {
            return reply.code(400).send({ error: { code: 'INVALID_PARAMETER', message: 'audio must be "sub" or "dub"' } });
        }

        const typedAudio = audio as MegaplayAudio;

        const megaplayResult = await megaplay.getAnimeSources(anilistId, episode, typedAudio);

        const sources = megaplayResult.sources;
        const subtitles = megaplayResult.subtitles;
        const diagnostics = megaplayResult.diagnostics;

        if (sources.length === 0) {
            return reply.code(404).send({
                error: {
                    code: 'NO_SOURCES_AVAILABLE',
                    message: diagnostics[0]?.message ?? 'No sources found on any provider',
                },
            });
        }
        return reply.send({
            responseId: `anime-${anilistId}-${episode}-${audio}`,
            sources,
            subtitles,
            diagnostics,
        });
            });

    // Metadata endpoints — proxy TMDB so the frontend doesn't need its own key
    const tmdbKey = process.env.TMDB_API_KEY;
    server.getInstance().get<{ Params: { id: string } }>(
        '/v1/meta/movie/:id',
        async (request, reply) => {
            const { id } = request.params;
            if (!tmdbKey) return reply.code(503).send({ error: 'TMDB_API_KEY not configured' });
            try {
                const res = await fetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${tmdbKey}`);
                if (!res.ok) return reply.code(res.status).send({ error: 'TMDB error' });
                const d = await res.json() as { title?: string; backdrop_path?: string | null; poster_path?: string | null };
                const posterUrl = d.backdrop_path
                    ? `https://image.tmdb.org/t/p/original${d.backdrop_path}`
                    : d.poster_path
                    ? `https://image.tmdb.org/t/p/original${d.poster_path}`
                    : null;
                return reply.send({ title: d.title ?? null, posterUrl });
            } catch {
                return reply.code(500).send({ error: 'Failed to fetch metadata' });
            }
        }
    );

    server.getInstance().get<{ Params: { id: string } }>(
        '/v1/meta/tv/:id',
        async (request, reply) => {
            const { id } = request.params;
            if (!tmdbKey) return reply.code(503).send({ error: 'TMDB_API_KEY not configured' });
            try {
                const res = await fetch(`https://api.themoviedb.org/3/tv/${id}?api_key=${tmdbKey}`);
                if (!res.ok) return reply.code(res.status).send({ error: 'TMDB error' });
                const d = await res.json() as { name?: string; backdrop_path?: string | null; poster_path?: string | null };
                const posterUrl = d.backdrop_path
                    ? `https://image.tmdb.org/t/p/original${d.backdrop_path}`
                    : d.poster_path
                    ? `https://image.tmdb.org/t/p/original${d.poster_path}`
                    : null;
                return reply.send({ title: d.name ?? null, posterUrl });
            } catch {
                return reply.code(500).send({ error: 'Failed to fetch metadata' });
            }
        }
    );

    // Token endpoint — issues short-lived HMAC-signed tokens for the embed player.
    // Uses NODE_SECRET (same secret deployed to CF worker as TOKEN_SECRET).
    // If the env var is not set, returns an open placeholder (dev mode).
    server.getInstance().get('/v1/token', async (_request, reply) => {
        const secret = process.env.TOKEN_SECRET;
        const expiresIn = 5 * 60; // 5 minutes
        if (!secret) {
            return reply.send({
                token: 'open',
                expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
            });
        }
        const ts = Math.floor(Date.now() / 1000).toString();
        const sig = createHmac('sha256', secret).update(ts).digest('hex');
        return reply.send({
            token: `${ts}.${sig}`,
            expiresAt: new Date((parseInt(ts, 10) + expiresIn) * 1000).toISOString(),
        });
    });

    await server.start();

    const publicUrl =
        process.env.PUBLIC_URL ??
        `http://${process.env.HOST ?? 'localhost'}:${process.env.PORT ?? 3000}`;

    const uiUrl = `https://ui.cinepro.cc/?omssurl=${encodeURIComponent(publicUrl)}`;

    const title = '🚀 CinePro/ui is in public testing';
    const contrib =
        '🤝 We are looking for contributors to improve and develop!';
    const repo = 'Contribute: https://github.com/cinepro-org/ui';
    const tryIt = `🌐 Try it out: ${uiUrl} !`;
    const note =
        'You will need to give the website "access to local applications" that it works.';

    const lines = [title, '', repo, '', contrib, '', tryIt, '', note];

    // compute box width based on longest line
    const width = Math.max(...lines.map((l) => l.length)) + 2;

    const borderTop = '╭' + '─'.repeat(width) + '╮';
    const borderBottom = '╰' + '─'.repeat(width) + '╯';

    const pad = (line: string) => '│ ' + line.padEnd(width - 2, ' ') + ' │';

    console.log(`
================== CINEPRO BETA ANNOUNCEMENT ==================

${borderTop}
${lines.map(pad).join('\n')}
${borderBottom}
`);
}

main().catch((err) => {
    console.error('[Server] Fatal startup error:', err);
    process.exit(1);
});
