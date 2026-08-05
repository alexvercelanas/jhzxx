import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

type MediaType = "movie" | "tv" | "anime";
type AnimeTrack = "sub" | "dub";

/**
 * Robust clipboard copy: the primary target for this app is an iframe (the
 * mockup/preview surface and third-party sites embedding the docs), where
 * `navigator.clipboard` can be missing or blocked by permissions policy even
 * though the page is served over https. Fall back to a hidden-textarea +
 * `execCommand('copy')` so the button still works in those contexts, and
 * surface a distinct "failed" state instead of silently doing nothing.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    throw new Error("Clipboard API unavailable");
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
}

type CopyState = "idle" | "copied" | "failed";

function CopyIconButton({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");

  const handleClick = async () => {
    const ok = await copyToClipboard(text);
    setState(ok ? "copied" : "failed");
    setTimeout(() => setState("idle"), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="button-copy-code"
      title={
        state === "failed"
          ? "Copy failed — select the text manually"
          : "Copy to clipboard"
      }
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors shrink-0",
        state === "copied" &&
          "bg-[#00e5a0]/15 border-[#00e5a0]/40 text-[#00e5a0]",
        state === "failed" && "bg-red-500/10 border-red-500/40 text-red-400",
        state === "idle" &&
          "bg-white/5 border-white/10 text-gray-400 hover:text-white hover:border-white/20 hover:bg-white/10",
        className,
      )}
    >
      {state === "copied" && <Check className="w-3.5 h-3.5" />}
      {state === "failed" && <X className="w-3.5 h-3.5" />}
      {state === "idle" && <Copy className="w-3.5 h-3.5" />}
      {state === "copied" ? "Copied" : state === "failed" ? "Failed" : "Copy"}
    </button>
  );
}

// Lightweight hand-rolled tokenizer for the iframe snippets shown in the docs —
// pulling in a full syntax-highlighting library would be overkill for a handful
// of fixed markup blocks. Matches (in order of priority): tag delimiters
// (<iframe, </iframe, >, />), attribute names (only the word right before an
// `=`, so bare boolean attributes like `allowfullscreen` fall through as plain
// text), and quoted string values.
const HTML_TOKEN_RE = /<\/?[a-zA-Z][\w-]*|\/?>|[a-zA-Z-]+(?==)|"[^"]*"/g;

function highlightHtml(code: string) {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = HTML_TOKEN_RE.exec(code)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <React.Fragment key={key++}>
          {code.slice(lastIndex, match.index)}
        </React.Fragment>,
      );
    }
    const token = match[0];
    let className = "";
    if (token.startsWith("<") || token === ">" || token === "/>") {
      className = "text-[#ff5fa8]"; // tag delimiters
    } else if (token.startsWith('"')) {
      className = "text-[#f2c14e]"; // string values
    } else {
      className = "text-[#66d9ef]"; // attribute names
    }
    nodes.push(
      <span key={key++} className={className}>
        {token}
      </span>,
    );
    lastIndex = match.index + token.length;
  }
  if (lastIndex < code.length) {
    nodes.push(
      <React.Fragment key={key++}>{code.slice(lastIndex)}</React.Fragment>,
    );
  }
  return nodes;
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative group rounded-lg border border-white/5 overflow-hidden bg-black">
      <div className="absolute top-2 right-2 z-10">
        <CopyIconButton text={code} />
      </div>
      <pre className="p-4 pr-20 font-mono text-[13px] leading-relaxed text-gray-200 overflow-x-auto whitespace-pre">
        <code>{highlightHtml(code)}</code>
      </pre>
    </div>
  );
}

export default function Home() {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://cinepro.com";
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  const DEFAULT_MOVIE_ID = "299536"; // Avengers: Infinity War
  const DEFAULT_TV_ID = "1399"; // Game of Thrones
  const DEFAULT_ANILIST_ID = "21"; // One Piece

  const [mediaType, setMediaType] = useState<MediaType>("movie");
  const [tmdbId, setTmdbId] = useState(DEFAULT_MOVIE_ID);
  const [season, setSeason] = useState("1");
  const [episode, setEpisode] = useState("1");
  const [anilistId, setAnilistId] = useState(DEFAULT_ANILIST_ID);
  const [animeEpisode, setAnimeEpisode] = useState("1");
  const [animeTrack, setAnimeTrack] = useState<AnimeTrack>("sub");
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const handleMediaTypeChange = (type: MediaType) => {
    setMediaType(type);
    if (type === "movie") setTmdbId(DEFAULT_MOVIE_ID);
    else if (type === "tv") setTmdbId(DEFAULT_TV_ID);
  };

  const embedPath = useMemo(() => {
    if (mediaType === "anime") {
      const id = anilistId.trim() || DEFAULT_ANILIST_ID;
      return `${basePath}/anime/${id}/${animeEpisode.trim() || "1"}/${animeTrack}`;
    }
    const id =
      tmdbId.trim() ||
      (mediaType === "movie" ? DEFAULT_MOVIE_ID : DEFAULT_TV_ID);
    if (mediaType === "movie") return `${basePath}/movie/${id}`;
    return `${basePath}/tv/${id}/${season.trim() || "1"}/${episode.trim() || "1"}`;
  }, [
    mediaType,
    tmdbId,
    season,
    episode,
    anilistId,
    animeEpisode,
    animeTrack,
    basePath,
  ]);

  const embedUrl = `${origin}${embedPath}`;

  const handleCopy = async () => {
    const ok = await copyToClipboard(embedUrl);
    setCopyState(ok ? "copied" : "failed");
    setTimeout(() => setCopyState("idle"), 1500);
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-[#050c08] text-white font-sans">
      <div className="w-full max-w-5xl mx-auto flex flex-col flex-1 p-4 sm:p-6 gap-4">
        <div className="flex items-center gap-3 justify-center">
          <div className="w-8 h-8 bg-[#00e5a0]/20 border border-[#00e5a0]/50 rounded flex items-center justify-center text-[#00e5a0] font-bold">
            CP
          </div>
          <h1 className="text-2xl font-bold tracking-wider text-white">
            CinePro
          </h1>
        </div>

        {/* Tester toolbar */}
        <div className="bg-[#0d1a12] border border-[#00e5a0]/20 rounded-xl p-3 flex flex-wrap items-center gap-3">
          <div
            className="flex rounded-md overflow-hidden border border-white/10 shrink-0"
            data-testid="group-media-type"
          >
            <button
              type="button"
              onClick={() => handleMediaTypeChange("movie")}
              data-testid="button-media-movie"
              className={cn(
                "px-4 py-1.5 text-sm font-medium transition-colors",
                mediaType === "movie"
                  ? "bg-[#00e5a0] text-black"
                  : "bg-transparent text-gray-400 hover:text-white",
              )}
            >
              Movie
            </button>
            <button
              type="button"
              onClick={() => handleMediaTypeChange("tv")}
              data-testid="button-media-tv"
              className={cn(
                "px-4 py-1.5 text-sm font-medium transition-colors",
                mediaType === "tv"
                  ? "bg-[#00e5a0] text-black"
                  : "bg-transparent text-gray-400 hover:text-white",
              )}
            >
              TV
            </button>
            <button
              type="button"
              onClick={() => handleMediaTypeChange("anime")}
              data-testid="button-media-anime"
              className={cn(
                "px-4 py-1.5 text-sm font-medium transition-colors",
                mediaType === "anime"
                  ? "bg-[#00e5a0] text-black"
                  : "bg-transparent text-gray-400 hover:text-white",
              )}
            >
              Anime
            </button>
          </div>

          <div className="h-6 w-px bg-white/10 shrink-0" />

          {mediaType === "anime" ? (
            <>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                  AniList ID
                </span>
                <Input
                  value={anilistId}
                  onChange={(e) =>
                    setAnilistId(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  placeholder={DEFAULT_ANILIST_ID}
                  data-testid="input-anilist-id"
                  className="w-24 h-8 bg-black/40 border-white/10 text-white text-center"
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                  E
                </span>
                <Input
                  value={animeEpisode}
                  onChange={(e) =>
                    setAnimeEpisode(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  placeholder="1"
                  data-testid="input-anime-episode"
                  className="w-14 h-8 bg-black/40 border-white/10 text-white text-center"
                />
              </div>
              <div
                className="flex rounded-md overflow-hidden border border-white/10 shrink-0"
                data-testid="group-anime-track"
              >
                <button
                  type="button"
                  onClick={() => setAnimeTrack("sub")}
                  data-testid="button-track-sub"
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium transition-colors",
                    animeTrack === "sub"
                      ? "bg-[#00e5a0] text-black"
                      : "bg-transparent text-gray-400 hover:text-white",
                  )}
                >
                  Sub
                </button>
                <button
                  type="button"
                  onClick={() => setAnimeTrack("dub")}
                  data-testid="button-track-dub"
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium transition-colors",
                    animeTrack === "dub"
                      ? "bg-[#00e5a0] text-black"
                      : "bg-transparent text-gray-400 hover:text-white",
                  )}
                >
                  Dub
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                  TMDB ID
                </span>
                <Input
                  value={tmdbId}
                  onChange={(e) =>
                    setTmdbId(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  placeholder={
                    mediaType === "movie" ? DEFAULT_MOVIE_ID : DEFAULT_TV_ID
                  }
                  data-testid="input-tmdb-id"
                  className="w-24 h-8 bg-black/40 border-white/10 text-white text-center"
                />
              </div>

              {mediaType === "tv" && (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                    S
                  </span>
                  <Input
                    value={season}
                    onChange={(e) =>
                      setSeason(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    placeholder="1"
                    data-testid="input-season"
                    className="w-14 h-8 bg-black/40 border-white/10 text-white text-center"
                  />
                  <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                    E
                  </span>
                  <Input
                    value={episode}
                    onChange={(e) =>
                      setEpisode(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    placeholder="1"
                    data-testid="input-episode"
                    className="w-14 h-8 bg-black/40 border-white/10 text-white text-center"
                  />
                </div>
              )}
            </>
          )}

          <div className="flex-1" />

          <Button
            onClick={handleCopy}
            size="sm"
            data-testid="button-copy-url"
            title={
              copyState === "failed"
                ? "Copy failed — select the URL manually"
                : undefined
            }
            className={cn(
              "shrink-0 border",
              copyState === "failed"
                ? "bg-red-500/10 text-red-400 border-red-500/40 hover:bg-red-500/15"
                : "bg-[#00e5a0] text-black border-[#00e5a0] hover:bg-[#00e5a0]/90",
            )}
          >
            {copyState === "copied" && <Check className="w-4 h-4" />}
            {copyState === "failed" && <X className="w-4 h-4" />}
            {copyState === "idle" && <Copy className="w-4 h-4" />}
            {copyState === "copied"
              ? "Copied"
              : copyState === "failed"
                ? "Copy failed"
                : "Copy URL"}
          </Button>
        </div>

        {/* Live preview */}
        <div className="flex-1 min-h-[320px] bg-black rounded-xl overflow-hidden border border-white/5 shadow-2xl">
          <iframe
            key={embedPath}
            src={embedPath}
            title="CinePro embed preview"
            className="w-full h-full min-h-[320px] aspect-video"
            frameBorder={0}
            allowFullScreen
            data-testid="iframe-preview"
          />
        </div>

        {/* Docs */}
        <div className="bg-[#0d1a12] border border-[#00e5a0]/20 rounded-xl p-6 sm:p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-[#00e5a0] mb-4">
            Embed Player Usage
          </h2>
          <p className="text-gray-400 mb-6 text-sm leading-relaxed">
            Use our high-performance, ad-free embed player on your site by
            including the iframe snippet below. We automatically find the best
            available streaming sources.
          </p>

          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-medium text-white mb-2">
                Movie Embed (by TMDB/IMDB ID)
              </h3>
              <CodeBlock
                code={`<iframe
  src="${origin}${basePath}/movie/{TmdbID/ImdbID}"
  width="100%"
  height="100%"
  frameborder="0"
  allowfullscreen
></iframe>`}
              />
            </div>

            <div>
              <h3 className="text-sm font-medium text-white mb-2">
                TV Show Embed  (by TMDB/IMDB ID)
              </h3>
              <CodeBlock
                code={`<iframe
  src="${origin}${basePath}/tv/{TmdbID/ImdbID}/{session}/{episode}"
  width="100%"
  height="100%"
  frameborder="0"
  allowfullscreen
></iframe>`}
              />
            </div>

            <div>
              <h3 className="text-sm font-medium text-white mb-2">
                Anime Embed (by AniList ID)
              </h3>
              <p className="text-gray-500 text-xs mb-2">
                Last URL segment is the audio track —{" "}
                <code className="text-gray-400">sub</code> or{" "}
                <code className="text-gray-400">dub</code>.
              </p>
              <CodeBlock
                code={`<iframe
  src="${origin}${basePath}/anime/{AnilistId}/{episode}/sub"
  width="100%"
  height="100%"
  frameborder="0"
  allowfullscreen
></iframe>`}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
