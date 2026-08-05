import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useSearch } from 'wouter';
import { VideoPlayer } from '@/components/VideoPlayer';
import type { Source } from '@/components/SourceSelector';
import { RefreshCcw } from 'lucide-react';
import { authHeaders } from '@/lib/apiToken';

interface ApiSubtitle {
  url: string;
  label: string;
  format?: string;
}

interface MovieResponse {
  responseId: string;
  sources: Source[];
  subtitles?: ApiSubtitle[];
}

/** Fetch poster/title from the server-side meta endpoint (matches CF worker /v1/meta/movie/:id). */
async function fetchMovieMeta(
  apiBase: string,
  tmdbId: string,
  headers: Record<string, string>,
): Promise<{ posterUrl: string | null; title: string | null }> {
  try {
    const res = await fetch(`${apiBase}/v1/meta/movie/${tmdbId}`, { headers });
    if (!res.ok) return { posterUrl: null, title: null };
    const d = await res.json();
    return { posterUrl: d.posterUrl ?? null, title: d.title ?? null };
  } catch {
    return { posterUrl: null, title: null };
  }
}

function useSkipParams() {
  const search = useSearch();
  const sp = new URLSearchParams(search);
  const n = (k: string) => sp.has(k) ? Number(sp.get(k)) : undefined;
  return { introStart: n('introStart'), introEnd: n('introEnd'), outroStart: n('outroStart'), outroEnd: n('outroEnd') };
}

export default function EmbedMovie() {
  const params = useParams<{ id: string }>();
  const rawId = params?.id ?? '';
  const { introStart, introEnd, outroStart, outroEnd } = useSkipParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [subtitles, setSubtitles] = useState<Array<{ language: string; url: string }>>([]);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!rawId) return;
    setLoading(true);
    setError(null);
    try {
      const apiBase = (import.meta.env.VITE_OMSS_URL as string) || '';

      const hdrs = await authHeaders();
      // Fetch sources + metadata in parallel so artwork doesn't block playback.
      const [sourcesRes] = await Promise.all([
        fetch(`${apiBase}/v1/movies/${rawId}`, { headers: hdrs }),
        fetchMovieMeta(apiBase, rawId, hdrs).then(({ posterUrl: poster, title: t }) => {
          setPosterUrl(poster);
          setTitle(t);
        }),
      ]);

      if (!sourcesRes.ok) throw new Error(`API error ${sourcesRes.status}`);
      const data: MovieResponse = await sourcesRes.json();
      setSources(data.sources ?? []);
      setSubtitles((data.subtitles ?? []).map(s => ({ language: s.label, url: s.url })));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching sources');
    } finally {
      setLoading(false);
    }
  }, [rawId]);

  useEffect(() => { load(); }, [load]);

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
      title={title ?? `Movie ${rawId}`}
      posterUrl={posterUrl}
      introStart={introStart}
      introEnd={introEnd}
      outroStart={outroStart}
      outroEnd={outroEnd}
    />
  );
}
