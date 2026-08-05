import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Subtitles,
  Check,
  Film,
  Settings,
  PictureInPicture2,
  Headphones,
} from 'lucide-react';
import { useHlsPlayer } from '@/hooks/useHlsPlayer';
import { providerName, type Source } from './SourceSelector';
import { useSubtitles } from '@/hooks/useSubtitles';

interface VideoPlayerProps {
  sources: Source[];
  subtitles?: Array<{ language: string; url: string }>;
  title: string;
  posterUrl?: string | null;
  introStart?: number;
  introEnd?: number;
  outroStart?: number;
  outroEnd?: number;
}

function formatTime(seconds: number) {
  if (isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const h = Math.floor(m / 60);
  const mDisplay = m % 60;
  if (h > 0) {
    return `${h}:${mDisplay.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const LANG_LABELS: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', pt: 'Portuguese',
  ar: 'Arabic', ru: 'Russian', it: 'Italian', nl: 'Dutch',
  tr: 'Turkish', de: 'German', ja: 'Japanese', ko: 'Korean',
  zh: 'Chinese', hi: 'Hindi', pl: 'Polish', sv: 'Swedish',
  no: 'Norwegian', da: 'Danish', fi: 'Finnish', he: 'Hebrew',
  id: 'Indonesian', ms: 'Malay', th: 'Thai', vi: 'Vietnamese',
};

function langLabel(lang: string): string {
  const lower = lang.toLowerCase().replace(/-.*$/, '');
  return LANG_LABELS[lower] ?? lang;
}

/* ── SVG skip icons matching the reference ──────────────────────────── */
function SkipBack10() {
  return (
    <svg viewBox="0 0 40 40" fill="white" className="w-8 h-8 sm:w-9 sm:h-9">
      <circle cx="20" cy="20" r="17" fill="none" stroke="white" strokeWidth="2" strokeDasharray="90 20" strokeLinecap="round" />
      {/* arrow head pointing left */}
      <path d="M20 5 L20 13 L13 9 Z" fill="white" />
      <text x="20" y="25" textAnchor="middle" fontSize="10" fontWeight="bold" fill="white" fontFamily="sans-serif">10</text>
    </svg>
  );
}

function SkipForward10() {
  return (
    <svg viewBox="0 0 40 40" fill="white" className="w-8 h-8 sm:w-9 sm:h-9">
      <circle cx="20" cy="20" r="17" fill="none" stroke="white" strokeWidth="2" strokeDasharray="90 20" strokeDashoffset="-20" strokeLinecap="round" />
      {/* arrow head pointing right */}
      <path d="M20 5 L20 13 L27 9 Z" fill="white" />
      <text x="20" y="25" textAnchor="middle" fontSize="10" fontWeight="bold" fill="white" fontFamily="sans-serif">10</text>
    </svg>
  );
}

export function VideoPlayer({ sources, subtitles: propSubtitles, title, posterUrl, introStart, introEnd, outroStart, outroEnd }: VideoPlayerProps) {
  const sortedSources = useMemo(
    () => [...sources].sort((a, b) => {
      const providerRank = (source: Source) => {
        const id = typeof source.provider === 'string' ? source.provider : source.provider?.id;
        return id === 'vaplayer' ? 0 : id === 'vidrift' ? 1 : id === 'animecurx' ? 2 : 3;
      };
      if (a.type === 'hls' && b.type !== 'hls') return -1;
      if (a.type !== 'hls' && b.type === 'hls') return 1;
      return providerRank(a) - providerRank(b);
    }),
    [sources]
  );

  const [activeSource, setActiveSource] = useState<Source | undefined>(sortedSources[0]);
  const [showQuality, setShowQuality]         = useState(false);
  const [showSubtitlePanel, setShowSubtitlePanel] = useState(false);
  const [showAudio, setShowAudio]             = useState(false);
  const [isIdle, setIsIdle]                   = useState(false);

  const idleTimeoutRef = useRef<number | null>(null);
  const containerRef   = useRef<HTMLDivElement>(null);

  const {
    videoRef, isPlaying, currentTime, duration, volume, isMuted,
    isBuffering, playbackQuality, hlsLevels, currentHlsLevel,
    setHlsLevel, hlsAudioTracks, currentAudioTrack, setAudioTrack,
    togglePlay, seek, skip, setVolume, toggleFullscreen,
  } = useHlsPlayer(
    activeSource?.url,
    activeSource?.type,
    (activeSource as any)?.audioTracks as Array<{ label: string; language: string }> | undefined,
  );

  const subtitleTracks = useMemo(() => {
    const sourceSubs = activeSource?.subtitles ?? [];
    const merged = [...(propSubtitles ?? [])];
    for (const s of sourceSubs) {
      if (!merged.find(t => t.language === s.language)) merged.push(s);
    }
    return merged;
  }, [activeSource, propSubtitles]);

  const {
    selectedLang, setSelectedLang, offset, adjustOffset, resetOffset,
    activeCueText, loading: subtitleLoading, OFFSET_STEP,
  } = useSubtitles(subtitleTracks, currentTime);

  // Skip intro / outro
  const showSkipIntro = introStart !== undefined && introEnd !== undefined &&
    currentTime >= introStart && currentTime < introEnd;
  const showSkipOutro = outroStart !== undefined && outroEnd !== undefined &&
    currentTime >= outroStart && currentTime < outroEnd;
  const showSkipButton = showSkipIntro || showSkipOutro;

  const isHlsSource = activeSource?.type === 'hls';

  const mp4QualityOptions = useMemo(() => {
    if (isHlsSource) return [];
    const activeProv = activeSource ? providerName(activeSource.provider) : '';
    return sortedSources.filter(s => providerName(s.provider) === activeProv);
  }, [sortedSources, activeSource, isHlsSource]);

  const handleActivity = useCallback(() => {
    setIsIdle(false);
    if (idleTimeoutRef.current) window.clearTimeout(idleTimeoutRef.current);
    idleTimeoutRef.current = window.setTimeout(() => {
      if (isPlaying) {
        setIsIdle(true);
        setShowQuality(false);
        setShowSubtitlePanel(false);
        setShowAudio(false);
      }
    }, 3000);
  }, [isPlaying]);

  useEffect(() => {
    handleActivity();
    return () => { if (idleTimeoutRef.current) window.clearTimeout(idleTimeoutRef.current); };
  }, [handleActivity]);

  useEffect(() => {
    if (sortedSources.length > 0 && !activeSource) setActiveSource(sortedSources[0]);
  }, [sortedSources, activeSource]);

  // postMessage bridge — lets a parent page listen for video events for auto-next
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnded = () => {
      window.top?.postMessage({ event: 'ended' }, '*');
      window.parent.postMessage({ event: 'ended' }, '*');
    };
    const onTimeUpdate = () => {
      window.parent.postMessage({
        event: 'timeupdate',
        time: v.currentTime,
        duration: v.duration || 0,
      }, '*');
    };
    v.addEventListener('ended', onEnded);
    v.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [videoRef]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); skip(-10); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); skip(10); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, skip]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seek((e.clientX - rect.left) / rect.width * duration);
  };

  const handleVolumeClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setVolume((e.clientX - rect.left) / rect.width);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const volumePercent   = volume * 100;

  const qualityLabel = isHlsSource
    ? (currentHlsLevel === -1 ? 'Auto' : playbackQuality)
    : (activeSource?.quality ?? 'Auto');

  // Only show audio button when there are 2+ tracks (multi-language streams)
  const hasMultiAudio = isHlsSource && hlsAudioTracks.length > 1;
  const audioLabel = hlsAudioTracks.find(t => t.id === currentAudioTrack)?.name ?? 'Audio';

  const hasSubtitles    = subtitleTracks.length > 0;
  const subtitleActive  = selectedLang !== null;

  /* PiP helper */
  const togglePip = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    } else {
      v.requestPictureInPicture().catch(() => {});
    }
  }, [videoRef]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[100dvh] bg-black text-white overflow-hidden font-sans select-none"
      onMouseMove={handleActivity}
      onMouseLeave={() => isPlaying && setIsIdle(true)}
      onClick={handleActivity}
    >
      {/* Video */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain bg-black"
        poster={posterUrl || undefined}
        onDoubleClick={toggleFullscreen}
        playsInline
        preload="auto"
      />

      {/* Poster vignette */}
      {!isPlaying && currentTime === 0 && posterUrl && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30 pointer-events-none" />
      )}

      {/* Click-through layer */}
      <div className="absolute inset-0 z-0" onClick={togglePlay} onDoubleClick={toggleFullscreen} />

      {/* ── Tap to unmute banner ──────────────────────────────────────── */}
      {isMuted && isPlaying && (
        <div className="absolute top-4 right-4 z-20 pointer-events-none animate-in fade-in duration-300">
          <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-sm border border-white/20 text-white/80 text-xs font-medium px-3 py-1.5 rounded-full">
            <VolumeX className="w-3.5 h-3.5" />
            Tap to unmute
          </div>
        </div>
      )}

      {/* ── Title — top left ──────────────────────────────────────────── */}
      <div className={`absolute top-4 left-4 flex items-center gap-2 z-10 transition-all duration-400 ${isIdle ? '-translate-y-12 opacity-0' : 'translate-y-0 opacity-100'}`}>
        <Film className="w-4 h-4 text-white/60 shrink-0" />
        <span className="text-sm font-medium text-white/90 drop-shadow">{title}</span>
      </div>

      {/* ── Buffering / startup loading indicator ────────────────────── */}
      {/* Show spinner when: actively buffering mid-play, OR video started
          but no frame yet (currentTime still 0). This closes the gap between
          calling play() and the first 'waiting' event so users don't see the
          pause button and think nothing is happening. */}
      {(isBuffering || (isPlaying && currentTime === 0)) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-20 gap-3">
          <div className="w-11 h-11 border-[3px] border-white/20 border-t-white rounded-full animate-spin" />
          {isPlaying && currentTime === 0 && (
            <span className="text-white/50 text-xs tracking-widest uppercase">Loading…</span>
          )}
        </div>
      )}

      {/* ── Center controls: [⟲10]  [▶]  [10⟳] ─────────────────────── */}
      {/* Hide skip/play controls while initially buffering so users don't
          accidentally pause the video before the first frame appears. */}
      <div className={`absolute inset-0 flex items-center justify-center z-10 pointer-events-none transition-opacity duration-300 ${(isIdle || (isPlaying && currentTime === 0)) ? 'opacity-0' : 'opacity-100'}`}>
        <div className="flex items-center gap-8 sm:gap-12 pointer-events-auto">
          {/* Skip back */}
          <button
            onClick={(e) => { e.stopPropagation(); skip(-10); handleActivity(); }}
            className="text-white hover:text-white/80 active:scale-90 transition-all drop-shadow-lg"
            aria-label="Rewind 10s"
          >
            <SkipBack10 />
          </button>

          {/* Play / Pause — large triangle, no border circle */}
          <button
            onClick={(e) => { e.stopPropagation(); togglePlay(); handleActivity(); }}
            className="text-white hover:text-white/80 active:scale-90 transition-all drop-shadow-lg"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying
              ? <Pause className="w-11 h-11 sm:w-14 sm:h-14 fill-current" />
              : <Play  className="w-11 h-11 sm:w-14 sm:h-14 fill-current ml-1" />}
          </button>

          {/* Skip forward */}
          <button
            onClick={(e) => { e.stopPropagation(); skip(10); handleActivity(); }}
            className="text-white hover:text-white/80 active:scale-90 transition-all drop-shadow-lg"
            aria-label="Skip 10s"
          >
            <SkipForward10 />
          </button>
        </div>
      </div>

      {/* ── Skip Intro / Outro button ────────────────────────────────── */}
      {showSkipButton && (
        <div className="absolute bottom-20 right-4 z-20 animate-in fade-in slide-in-from-right-4 duration-300">
          <button
            onClick={() => seek(showSkipIntro ? introEnd! : outroEnd!)}
            className="flex items-center gap-2 bg-black/70 hover:bg-black/90 border border-white/30 hover:border-white/60 text-white text-sm font-semibold px-4 py-2 rounded-lg backdrop-blur-sm transition-all active:scale-95"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 3.5a.5.5 0 0 1 .8-.4l7 4.5a.5.5 0 0 1 0 .8l-7 4.5A.5.5 0 0 1 3 12.5v-9Z"/>
              <rect x="11" y="3" width="2" height="10" rx="1"/>
            </svg>
            {showSkipIntro ? 'Skip Intro' : 'Skip Outro'}
          </button>
        </div>
      )}

      {/* ── Subtitle overlay ─────────────────────────────────────────── */}
      {activeCueText && (
        <div className={`absolute inset-x-0 z-10 flex justify-center pointer-events-none transition-all duration-300 ${isIdle ? 'bottom-4' : 'bottom-16'}`}>
          <div className="max-w-[80%] text-center">
            {activeCueText.split('\n').map((line, i) => (
              <div
                key={i}
                className="inline-block bg-black/80 text-white text-[17px] leading-snug font-medium px-3 py-1 rounded mx-auto"
                style={{ textShadow: '0 1px 4px rgba(0,0,0,0.9)', display: 'block' }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Subtitle Panel popover ───────────────────────────────────── */}
      {showSubtitlePanel && (
        <div className="absolute bottom-14 right-2 sm:right-24 w-[min(200px,_calc(100vw-1rem))] bg-[#111] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-20 backdrop-blur-xl">
          <div className="px-3 py-2 border-b border-white/5">
            <h3 className="text-[10px] font-bold tracking-widest text-white/50 uppercase mb-2">Subtitles</h3>
            <div className="flex items-center gap-1">
              <button onClick={() => adjustOffset(-OFFSET_STEP)} className="flex-1 text-[10px] font-bold text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded px-1 py-1 transition-colors">
                -{OFFSET_STEP}s
              </button>
              <span className="text-[10px] font-mono text-white/50 w-10 text-center shrink-0">
                {offset >= 0 ? `+${offset.toFixed(1)}s` : `${offset.toFixed(1)}s`}
              </span>
              <button onClick={() => adjustOffset(OFFSET_STEP)} className="flex-1 text-[10px] font-bold text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded px-1 py-1 transition-colors">
                +{OFFSET_STEP}s
              </button>
              <button onClick={resetOffset} className="text-[10px] text-white/30 hover:text-white bg-white/5 hover:bg-white/10 rounded px-1 py-1 transition-colors">✕</button>
            </div>
          </div>
          <div className="flex flex-col py-1 max-h-[min(180px,40vh)] overflow-y-auto">
            <button
              onClick={() => setSelectedLang(null)}
              className={`flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors relative ${selectedLang === null ? 'bg-white/5' : ''}`}
            >
              {selectedLang === null && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-white" />}
              <span className={`text-[12px] ${selectedLang === null ? 'text-white font-medium' : 'text-white/60'}`}>Off</span>
              {selectedLang === null && <Check className="w-3.5 h-3.5 text-white" />}
            </button>
            {hasSubtitles ? subtitleTracks.map((track) => {
              const isActive = selectedLang === track.language;
              return (
                <button key={track.language} onClick={() => setSelectedLang(track.language)}
                  className={`flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors relative ${isActive ? 'bg-white/5' : ''}`}>
                  {isActive && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-white" />}
                  <span className={`text-[12px] ${isActive ? 'text-white font-medium' : 'text-white/60'}`}>{langLabel(track.language)}</span>
                  {isActive && (subtitleLoading
                    ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <Check className="w-3.5 h-3.5 text-white" />)}
                </button>
              );
            }) : (
              <div className="px-3 py-4 text-center text-[11px] text-white/30">No subtitles for this source</div>
            )}
          </div>
        </div>
      )}

      {/* ── Audio Track Popover ──────────────────────────────────────── */}
      {showAudio && hasMultiAudio && (
        <div className="absolute bottom-14 right-2 sm:right-24 w-[min(160px,_calc(100vw-1rem))] bg-[#111] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-20 backdrop-blur-xl">
          <div className="px-3 py-2 border-b border-white/5">
            <h3 className="text-[10px] font-bold tracking-widest text-white/50 uppercase">Audio</h3>
          </div>
          <div className="flex flex-col py-1 max-h-[min(200px,45vh)] overflow-y-auto">
            {hlsAudioTracks.map((track) => {
              const isActive = track.id === currentAudioTrack;
              return (
                <button
                  key={track.id}
                  onClick={() => { setAudioTrack(track.id); setShowAudio(false); }}
                  className={`flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors relative ${isActive ? 'bg-white/5' : ''}`}
                >
                  {isActive && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-white" />}
                  <span className={`text-[12px] ${isActive ? 'text-white font-medium' : 'text-white/60'}`}>
                    {track.name}
                  </span>
                  {isActive && <Check className="w-3.5 h-3.5 text-white shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Quality Popover ──────────────────────────────────────────── */}
      {showQuality && (
        <div className="absolute bottom-14 right-2 sm:right-14 w-[min(140px,_calc(100vw-1rem))] bg-[#111] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-20 backdrop-blur-xl">
          <div className="px-3 py-2 border-b border-white/5">
            <h3 className="text-[10px] font-bold tracking-widest text-white/50 uppercase">Quality</h3>
          </div>
          <div className="flex flex-col py-1 max-h-[min(180px,40vh)] overflow-y-auto">
            {isHlsSource ? (
              <>
                <button onClick={() => { setHlsLevel(-1); setShowQuality(false); }}
                  className={`flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors relative ${currentHlsLevel === -1 ? 'bg-white/5' : ''}`}>
                  {currentHlsLevel === -1 && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-white" />}
                  <span className={`text-[12px] ${currentHlsLevel === -1 ? 'text-white font-medium' : 'text-white/60'}`}>Auto</span>
                  {currentHlsLevel === -1 && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
                {hlsLevels.map((lvl) => (
                  <button key={lvl.level} onClick={() => { setHlsLevel(lvl.level); setShowQuality(false); }}
                    className={`flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors relative ${currentHlsLevel === lvl.level ? 'bg-white/5' : ''}`}>
                    {currentHlsLevel === lvl.level && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-white" />}
                    <span className={`text-[12px] ${currentHlsLevel === lvl.level ? 'text-white font-medium' : 'text-white/60'}`}>{lvl.label}</span>
                    {currentHlsLevel === lvl.level && <Check className="w-3.5 h-3.5 text-white" />}
                  </button>
                ))}
              </>
            ) : mp4QualityOptions.map((src) => {
              const isActive = src.url === activeSource?.url;
              return (
                <button key={src.url} onClick={() => { setActiveSource(src); setShowQuality(false); }}
                  className={`flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors relative ${isActive ? 'bg-white/5' : ''}`}>
                  {isActive && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-white" />}
                  <span className={`text-[12px] ${isActive ? 'text-white font-medium' : 'text-white/60'}`}>{src.quality}</span>
                  {isActive && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Bottom bar ───────────────────────────────────────────────── */}
      <div className={`absolute bottom-0 inset-x-0 z-10 transition-transform duration-300  ${isIdle ? 'translate-y-full' : 'translate-y-0'}`}>
        {/* Seekbar — with side gaps matching the control row */}
        <div className="px-3 sm:px-5">
        <div
          className="w-full h-[3px] sm:h-[4px] cursor-pointer group/seek bg-white/20 relative rounded-full"
          onClick={handleSeek}
        >
          <div className="absolute inset-y-0 left-0 bg-white pointer-events-none transition-all" style={{ width: `${progressPercent}%` }} />
          {/* Expand hitbox on hover */}
          <div className="absolute -top-2 bottom-0 left-0 right-0" />
        </div>
        </div>

        {/* Control row */}
        <div className="flex items-center justify-between bg-[#0a0a0a]/95 backdrop-blur-md px-3 sm:px-5 py-2 sm:py-3">

          {/* Left: volume + time */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Volume */}
            <div className="flex items-center gap-1.5 group/vol">
              <button
                onClick={() => setVolume(volume === 0 ? 1 : 0)}
                className="text-white/80 hover:text-white transition-colors"
              >
                {volume === 0
                  ? <VolumeX className="w-[18px] h-[18px] sm:w-5 sm:h-5" />
                  : <Volume2 className="w-[18px] h-[18px] sm:w-5 sm:h-5" />}
              </button>
              {/* Expandable volume slider — desktop only */}
              <div className="w-0 overflow-hidden group-hover/vol:w-16 transition-all duration-200 hidden sm:flex items-center" onClick={handleVolumeClick}>
                <div className="w-16 h-[3px] bg-white/20 rounded-full relative cursor-pointer">
                  <div className="absolute inset-y-0 left-0 bg-white rounded-full pointer-events-none" style={{ width: `${volumePercent}%` }} />
                  <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow pointer-events-none" style={{ left: `${volumePercent}%`, transform: 'translate(-50%,-50%)' }} />
                </div>
              </div>
            </div>

            {/* Time */}
            <span className="text-[11px] sm:text-[13px] font-mono text-white/80 whitespace-nowrap">
              {formatTime(currentTime)}<span className="text-white/30 mx-1">/</span>{formatTime(duration)}
            </span>
          </div>

          {/* Right: CC, Settings, PiP, Fullscreen */}
          <div className="flex items-center gap-1 sm:gap-2">
            {/* Subtitles */}
            <button
              onClick={() => { setShowSubtitlePanel(!showSubtitlePanel); setShowQuality(false); setShowAudio(false); }}
              className={`p-1.5 rounded transition-colors relative ${subtitleActive || showSubtitlePanel ? 'text-white' : 'text-white/50 hover:text-white'}`}
              title="Subtitles"
            >
              <Subtitles className="w-[18px] h-[18px] sm:w-5 sm:h-5" />
              {subtitleActive && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white" />}
            </button>

            {/* Audio Language — only shown for multi-language streams */}
            {hasMultiAudio && (
              <button
                onClick={() => { setShowAudio(!showAudio); setShowQuality(false); setShowSubtitlePanel(false); }}
                className={`p-1.5 rounded transition-colors relative ${showAudio ? 'text-white' : 'text-white/50 hover:text-white'}`}
                title={`Audio: ${audioLabel}`}
              >
                <Headphones className="w-[18px] h-[18px] sm:w-5 sm:h-5" />
                {/* Dot indicator when non-default track is active */}
                {currentAudioTrack !== -1 && (
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white" />
                )}
              </button>
            )}

            {/* Quality / Settings */}
            <button
              onClick={() => { setShowQuality(!showQuality); setShowSubtitlePanel(false); setShowAudio(false); }}
              className={`p-1.5 rounded transition-colors ${showQuality ? 'text-white' : 'text-white/50 hover:text-white'}`}
              title={`Quality: ${qualityLabel}`}
            >
              <Settings className="w-[18px] h-[18px] sm:w-5 sm:h-5" />
            </button>

            {/* PiP */}
            <button
              onClick={togglePip}
              className="p-1.5 rounded text-white/50 hover:text-white transition-colors"
              title="Picture in Picture"
            >
              <PictureInPicture2 className="w-[18px] h-[18px] sm:w-5 sm:h-5" />
            </button>

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded text-white/50 hover:text-white transition-colors"
              title="Fullscreen"
            >
              <Maximize2 className="w-[18px] h-[18px] sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
