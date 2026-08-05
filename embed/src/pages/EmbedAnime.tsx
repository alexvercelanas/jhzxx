import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useSearch } from 'wouter';

function useSkipParams() {
  const search = useSearch();
  const sp = new URLSearchParams(search);
  const n = (k: string) => sp.has(k) ? Number(sp.get(k)) : undefined;
  return { introStart: n('introStart'), introEnd: n('introEnd'), outroStart: n('outroStart'), outroEnd: n('outroEnd') };
}
import { VideoPlayer } from '@/components/VideoPlayer';
import type { Source } from '@/components/SourceSelector';
import { RefreshCcw } from 'lucide-react';
import { authHeaders } from '@/lib/apiToken';

interface ApiSubtitle {
  url: string;
  label: string;
  format?: string;
}

interface AnimeResponse {
  responseId: string;
  sources: Source[];
  subtitles?: ApiSubtitle[];
}

interface AniListMedia {
  title?: { romaji?: string; english?: string };
  bannerImage?: string | null;
  coverImage?: { extraLarge?: string; large?: string };
}

/** AniList's public GraphQL API needs no key — used purely for title/poster display. */
async function resolveAniList(anilistId: string): Promise<{ title: string | null; posterUrl: string | null }> {
  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query ($id: Int) { Media(id: $id, type: ANIME) { title { romaji english } bannerImage coverImage { extraLarge large } } }`,
        variables: { id: Number(anilistId) },
      }),
    });
    if (!res.ok) return { title: null, posterUrl: null };
    const data = await res.json();
    const media: AniListMedia | undefined = data?.data?.Media;
    if (!media) return { title: null, posterUrl: null };
    return {
      title: media.title?.english ?? media.title?.romaji ?? null,
      posterUrl: media.bannerImage ?? media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
    };
  } catch {
    return { title: null, posterUrl: null };
  }
}

export default function EmbedAnime() {
  const params = useParams<{ id: string; episode: string; track: string }>();
  const anilistId = params?.id ?? '';
  const episode = params?.episode ?? '';
  const track = (params?.track ?? 'sub') === 'dub' ? 'dub' : 'sub';
  const { introStart, introEnd, outroStart, outroEnd } = useSkipParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [subtitles, setSubtitles] = useState<Array<{ language: string; url: string }>>([]);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!anilistId || !episode) return;
    setLoading(true);
    setError(null);
    try {
      // The API only needs the AniList ID. Fetch playable sources immediately
      // instead of waiting for optional title/poster metadata first.
      const apiBase = (import.meta.env.VITE_OMSS_URL as string) || '';
      const [hdrs] = await Promise.all([authHeaders()]);
      const metadataPromise = resolveAniList(anilistId);
      const res = await fetch(`${apiBase}/v1/anime/${anilistId}/${episode}/${track}`, { headers: hdrs });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `API error ${res.status}`);
      }
      const data: AnimeResponse = await res.json();
      setSources(data.sources ?? []);
      setSubtitles((data.subtitles ?? []).map((s) => ({ language: s.label, url: s.url })));
      void metadataPromise.then((metadata) => {
        setTitle(metadata.title);
        setPosterUrl(metadata.posterUrl);
      }).catch(() => {
        // Metadata is optional; playable sources are already rendered.
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching sources');
    } finally {
      setLoading(false);
    }
  }, [anilistId, episode, track]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-[100dvh] bg-[#050c08] text-white relative overflow-hidden">
        {posterUrl && (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center opacity-30"
              style={{ backgroundImage: `url(${posterUrl})` }}
            />
            <div className="absolute inset-0 bg-[#050c08]/80 backdrop-blur-sm" />
          </>
        )}
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-[#00e5a0] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400 font-medium tracking-wide">Fetching sources…</p>
        </div>
      </div>
    );
  }

  if (error || sources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-[100dvh] bg-[#050c08] text-white">
        <p className="text-gray-400 mb-4">{error ?? 'No sources found'}</p>
        <button
          onClick={load}
          className="flex items-center gap-2 bg-[#00e5a0]/10 hover:bg-[#00e5a0]/20 text-[#00e5a0] px-4 py-2 rounded-lg transition-colors border border-[#00e5a0]/30"
        >
          <RefreshCcw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <VideoPlayer
      sources={sources}
      subtitles={subtitles}
      title={title ? `${title} — Episode ${episode} (${track})` : `Episode ${episode} (${track})`}
      posterUrl={posterUrl}
      introStart={introStart}
      introEnd={introEnd}
      outroStart={outroStart}
      outroEnd={outroEnd}
    />
  );
}
