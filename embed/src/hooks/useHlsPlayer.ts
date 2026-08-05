import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';

export interface HlsLevel {
  level: number;    // hls.js level index (-1 = auto)
  height: number;
  bitrate: number;
  label: string;    // e.g. "1080p"
}

export interface HlsAudioTrack {
  id: number;
  name: string;   // NAME= attribute from the m3u8, e.g. "English", "हिन्दी"
  lang: string;   // LANGUAGE= attribute, e.g. "en", "hi"
}

export function useHlsPlayer(
  src: string | undefined,
  type: 'hls' | 'mp4' = 'hls',
  sourceAudioTracks?: Array<{ label: string; language: string }>,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isMuted, setIsMuted] = useState(true); // starts muted for autoplay
  const [playbackQuality, setPlaybackQuality] = useState('Auto');
  const [hlsLevels, setHlsLevels] = useState<HlsLevel[]>([]);
  const [currentHlsLevel, setCurrentHlsLevel] = useState<number>(-1); // -1 = auto
  const [hlsAudioTracks, setHlsAudioTracks] = useState<HlsAudioTrack[]>([]);
  const [currentAudioTrack, setCurrentAudioTrack] = useState<number>(-1);
  const hlsRef = useRef<Hls | null>(null);

  // Persisted across src changes so quality-switch can resume position + state
  const savedTimeRef = useRef(0);
  const wasPlayingRef = useRef(false);

  // Tracks any pending canplay safety-net handler so we can cancel it before adding another
  const pendingResumeRef = useRef<(() => void) | null>(null);
  const hasLoadedSourceRef = useRef(false);
  const savedMutedRef = useRef(false);

  // Level-based audio switching (for muxed-per-group manifests like ModiPlay/Hanerix).
  // Maps synthetic track id → audio group id, and audio group id → level indices.
  const audioGroupByTrackIdRef = useRef<Map<number, string>>(new Map());
  const levelsByAudioGroupRef  = useRef<Map<string, number[]>>(new Map());

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    // Grab the position/state saved by the previous cleanup
    const resumeTime = savedTimeRef.current;
    const shouldPlay = wasPlayingRef.current;
    const isInitialSource = !hasLoadedSourceRef.current;
    savedTimeRef.current = 0;
    wasPlayingRef.current = false;
    hasLoadedSourceRef.current = true;

    // Reset HLS level + audio info for new source
    setHlsLevels([]);
    setCurrentHlsLevel(-1);
    setHlsAudioTracks([]);
    setCurrentAudioTrack(-1);

    // --- event handlers ---
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onDurationChange = () => setDuration(video.duration);
    const onVolumeChange = () => { setVolumeState(video.volume); setIsMuted(video.muted); };
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const startMutedPlayback = () => {
      if (isInitialSource && video.paused) {
        video.muted = true;
        video.play().catch(() => {});
      }
    };

    // onLoadedMetadata: only seek, never call play() here.
    // play() called from here is far from the original user gesture and gets
    // silently blocked by the browser's autoplay policy. We use video.autoplay
    // instead (set before src assignment) so the browser starts on its own.
    const onLoadedMetadata = () => {
      if (resumeTime > 0) {
        video.currentTime = resumeTime;
      }
    };

    const attach = () => {
      video.addEventListener('play', onPlay);
      video.addEventListener('pause', onPause);
      video.addEventListener('timeupdate', onTimeUpdate);
      video.addEventListener('durationchange', onDurationChange);
      video.addEventListener('volumechange', onVolumeChange);
      video.addEventListener('waiting', onWaiting);
      video.addEventListener('playing', onPlaying);
      video.addEventListener('loadedmetadata', onLoadedMetadata);
      // once:true — fires only on the very first canplay so muted autoplay
      // doesn't restart the video every time the user pauses and the buffer refills
      video.addEventListener('canplay', startMutedPlayback, { once: true });
    };

    const detach = () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('canplay', startMutedPlayback);
    };

    // One-shot flag: once we've initiated autoplay for this source load, never
    // call play() again from background events (FRAG_BUFFERED, MANIFEST_PARSED).
    // Without this, every new HLS segment buffered while the user is paused
    // would call play() and override the deliberate pause.
    let hasAutostarted = false;

    // Muted autoplay is allowed by browsers without a user gesture. This gets
    // the first frame on screen immediately; a click/volume interaction unmutes.
    video.autoplay = shouldPlay || isInitialSource;
    video.muted = isInitialSource ? true : savedMutedRef.current;
    video.defaultMuted = isInitialSource ? true : savedMutedRef.current;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.preload = 'auto';

    attach();

    if (type === 'hls' && Hls.isSupported()) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        autoStartLoad: true,
        startFragPrefetch: true,
        // Feed the decoder from each fragment as bytes arrive instead of waiting for the
        // whole segment to finish downloading. Our segments come through a proxy hop
        // (extra round-trip vs. fetching the CDN directly), so this shaves real time off
        // every fragment's "download complete -> frame available" gap.
        progressive: true,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        // Trim buffered-but-already-played data so long sessions don't hold megabytes of
        // stale segments in memory, which can itself cause GC-related playback hiccups.
        backBufferLength: 90,
        // Start on the lowest rendition and let ABR ramp up after the bandwidth estimate
        // stabilizes. Starting at -1 (auto) can guess a level that's too high for the
        // proxy's added latency, causing an immediate stall right at playback start.
        startLevel: 0,
        abrEwmaFastLive: 3,
        abrEwmaSlowLive: 9,
        // Recover from a stalled fragment fetch quickly (short retry, more attempts)
        // rather than the default backoff, which shows as a long visible freeze.
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 500,
        fragLoadingMaxRetryTimeout: 8000,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 500,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 500,
        // Leave a little room for proxy jitter without making startup wait for a
        // large buffer. The first fragment is enough to begin playback.
        maxBufferHole: 0.5,
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      // Build the quality levels list once the manifest is parsed
      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        const levels: HlsLevel[] = data.levels.map((l, i) => ({
          level: i,
          height: l.height ?? 0,
          bitrate: l.bitrate ?? 0,
          label: l.height ? `${l.height}p` : `Level ${i}`,
        }));
        levels.sort((a, b) => b.height - a.height);
        setHlsLevels(levels);
        setCurrentHlsLevel(-1);

        // ── Alt-audio tracks (demuxed, same group) ───────────────────────
        // Use data.audioTracks — contains ALL tracks across all groups,
        // unlike hls.audioTracks which is filtered to the current level's group.
        const tracks: HlsAudioTrack[] = data.audioTracks.map((t) => ({
          id: t.id,
          name: t.name ?? t.lang ?? `Track ${t.id}`,
          lang: t.lang ?? '',
        }));
        if (tracks.length > 0) {
          setHlsAudioTracks(tracks);
          const english = data.audioTracks.find(
            (t) => t.lang?.startsWith('en') || t.name?.toLowerCase().startsWith('eng') || t.name?.toLowerCase() === 'english'
          );
          if (english !== undefined) {
            hls.audioTrack = english.id;
            setCurrentAudioTrack(english.id);
          } else {
            setCurrentAudioTrack(hls.audioTrack);
          }
        } else if (sourceAudioTracks && sourceAudioTracks.length > 1) {
          // ── Muxed-per-group fallback (e.g. ModiPlay/Hanerix) ─────────────
          // No demuxed alt audio detected. Scan levels for unique AUDIO group IDs.
          // Each group carries one language muxed into the video stream, so
          // switching means switching to the right level.
          const groupToLevels = new Map<string, number[]>();
          data.levels.forEach((l, i) => {
            // hls.js exposes the raw AUDIO= attribute via attrs
            const groupId: string = (l as any).attrs?.AUDIO ?? (l as any).audioGroupIds?.[0] ?? '';
            if (groupId) {
              if (!groupToLevels.has(groupId)) groupToLevels.set(groupId, []);
              groupToLevels.get(groupId)!.push(i);
            }
          });

          if (groupToLevels.size > 1) {
            levelsByAudioGroupRef.current  = groupToLevels;
            audioGroupByTrackIdRef.current = new Map();
            const syntheticTracks: HlsAudioTrack[] = [];
            let tid = 0;
            for (const [groupId] of groupToLevels) {
              const gLower = groupId.toLowerCase();
              const match  = sourceAudioTracks.find(
                t => t.language.toLowerCase() === gLower || t.label.toLowerCase() === gLower,
              );
              syntheticTracks.push({ id: tid, name: match?.label ?? groupId, lang: match?.language ?? groupId });
              audioGroupByTrackIdRef.current.set(tid, groupId);
              tid++;
            }
            setHlsAudioTracks(syntheticTracks);
            // Auto-select English
            const eng = syntheticTracks.find(t => t.lang.startsWith('en') || t.name.toLowerCase().includes('english'));
            const defaultTrack = eng ?? syntheticTracks[0];
            setCurrentAudioTrack(defaultTrack.id);
            // Switch to the English (or first) group's best level
            const targetLevels = groupToLevels.get(audioGroupByTrackIdRef.current.get(defaultTrack.id)!) ?? [];
            if (targetLevels.length > 0) hls.nextLevel = targetLevels[0];
          }
        }

        // Be explicit because some browsers pause hls.js startup when the video
        // element is initially muted/autoplaying inside a cross-origin iframe.
        hls.startLoad(-1);
        if (isInitialSource && !hasAutostarted) {
          hasAutostarted = true;
          video.muted = true;
          video.play().catch(() => {});
        }
      });

      // Some streams deliver audio track metadata after the manifest event.
      // Only grow the list — never shrink it. Separate-audio-group streams
      // (e.g. ModiPlay) fire this event after every level switch with only
      // the new group's single track; overwriting would hide the other languages.
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        const incoming: HlsAudioTrack[] = hls.audioTracks.map((t) => ({
          id: t.id,
          name: t.name ?? t.lang ?? `Track ${t.id}`,
          lang: t.lang ?? '',
        }));
        setHlsAudioTracks((prev) => {
          // Merge: keep existing tracks, append any new ones not already present
          if (incoming.length <= prev.length) return prev;
          const ids = new Set(prev.map((t) => t.id));
          const merged = [...prev, ...incoming.filter((t) => !ids.has(t.id))];
          return merged;
        });
        // Only auto-select English once (when currentAudioTrack is still -1)
        setCurrentAudioTrack((prev) => {
          if (prev !== -1) return prev;
          const english = hls.audioTracks.find(
            (t) => t.lang?.startsWith('en') || t.name?.toLowerCase() === 'english'
          );
          if (english !== undefined) {
            hls.audioTrack = english.id;
            return english.id;
          }
          return hls.audioTrack;
        });
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
        setCurrentAudioTrack(data.id);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // Retry the failed manifest/level/fragment without rebuilding the
          // player or throwing away already-buffered media.
          hls.startLoad(-1);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          // A fatal error that cannot be recovered in place should release the
          // broken controller rather than leave it retrying forever at 0:00.
          hls.destroy();
          hlsRef.current = null;
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        const level = hls.levels[data.level];
        if (level) setPlaybackQuality(level.height ? `${level.height}p` : 'Auto');
        setCurrentHlsLevel(hls.autoLevelEnabled ? -1 : data.level);
      });

      // A manifest can be parsed before the first media fragment is attached
      // to the video element. Retry at the first buffered fragment so muted
      // autoplay starts at the earliest reliable playback point.
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        if (isInitialSource && !hasAutostarted && video.paused) {
          hasAutostarted = true;
          video.muted = true;
          video.play().catch(() => {});
        }
      });

      return () => {
        savedTimeRef.current = video.currentTime;
        wasPlayingRef.current = !video.paused;
        savedMutedRef.current = video.muted;
        video.autoplay = false;
        detach();
        hls.destroy();
        hlsRef.current = null;
        video.src = '';
      };
    } else {
      // Native HLS (Safari) or plain MP4
      video.src = src;
      video.load();
      if (isInitialSource) video.play().catch(() => {});
      return () => {
        savedTimeRef.current = video.currentTime;
        wasPlayingRef.current = !video.paused;
        savedMutedRef.current = video.muted;
        video.autoplay = false;
        detach();
        video.src = '';
      };
    }
  }, [src, type]);

  /** Switch the HLS audio track by track id. Handles two manifest structures:
   *  1. Demuxed alt audio (same AUDIO group, multiple URIs) → hls.audioTrack
   *  2. Muxed-per-group (one language per AUDIO group, baked into video stream)
   *     → level switch to the variant with the matching audio group id. */
  const setAudioTrack = useCallback((id: number) => {
    const hls = hlsRef.current;
    if (!hls) return;

    const targetGroupId = audioGroupByTrackIdRef.current.get(id);
    if (targetGroupId) {
      // Muxed-per-group path: switch to the level with this audio group that
      // is closest in quality to the currently playing level.
      const candidates = levelsByAudioGroupRef.current.get(targetGroupId) ?? [];
      if (candidates.length > 0) {
        const curIdx     = hls.currentLevel >= 0 ? hls.currentLevel : hls.nextLevel;
        const curHeight  = curIdx >= 0 ? (hls.levels[curIdx]?.height ?? 0) : 0;
        let best = candidates[0];
        if (curHeight > 0) {
          let bestDiff = Infinity;
          for (const li of candidates) {
            const diff = Math.abs((hls.levels[li]?.height ?? 0) - curHeight);
            if (diff < bestDiff) { bestDiff = diff; best = li; }
          }
        }
        hls.nextLevel = best;
      }
    } else {
      // Standard demuxed alt audio path
      hls.audioTrack = id;
    }
    setCurrentAudioTrack(id);
  }, []);

  /** For HLS sources: switch quality without buffer flush — no stall, no rebuffering. */
  const setHlsLevel = useCallback((level: number) => {
    const hls = hlsRef.current;
    const video = videoRef.current;
    if (!hls) return;

    const wasPlaying = video ? !video.paused : false;

    if (level === -1) {
      // Re-enable ABR. Setting currentLevel=-1 in hls.js specifically means
      // "hand control back to the ABR algorithm" — it does NOT flush buffers.
      hls.currentLevel = -1;
    } else {
      // nextLevel schedules the switch at the next segment boundary.
      // The existing buffer is kept intact so playback never stalls mid-segment.
      // (currentLevel forces an immediate flush and causes the buffering spinner.)
      hls.nextLevel = level;
    }

    // Optimistically update the label immediately
    setCurrentHlsLevel(level);
    setPlaybackQuality(
      level === -1
        ? 'Auto'
        : hls.levels[level]?.height
          ? `${hls.levels[level].height}p`
          : 'Auto'
    );

    // Safety net: resume if browser stalled during the boundary switch.
    // Always cancel any prior pending handler first to prevent listener stacking
    // on rapid quality changes.
    if (video) {
      if (pendingResumeRef.current) {
        video.removeEventListener('canplay', pendingResumeRef.current);
        pendingResumeRef.current = null;
      }
      if (wasPlaying) {
        const resume = () => {
          video.play().catch(() => {});
          pendingResumeRef.current = null;
        };
        pendingResumeRef.current = resume;
        video.addEventListener('canplay', resume, { once: true });
      }
    }
  }, []);

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    video.play().catch(() => {});
  }, []);

  const pause = useCallback(() => {
    videoRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.muted = false;
      v.play().catch(() => {});
    } else if (v.muted) {
      // Video is autoplaying muted — first interaction should unmute, not pause
      v.muted = false;
    } else {
      v.pause();
    }
  }, []);

  const seek = useCallback((time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time;
  }, []);

  const skip = useCallback((seconds: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + seconds));
  }, []);

  const setVolume = useCallback((val: number) => {
    if (videoRef.current) {
      videoRef.current.volume = Math.max(0, Math.min(1, val));
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = videoRef.current?.parentElement;
    if (!container) return;
    if (!document.fullscreenElement) container.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }, []);

  return {
    videoRef,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    isBuffering,
    playbackQuality,
    hlsLevels,
    currentHlsLevel,
    setHlsLevel,
    hlsAudioTracks,
    currentAudioTrack,
    setAudioTrack,
    play,
    pause,
    togglePlay,
    seek,
    skip,
    setVolume,
    toggleFullscreen,
  };
}
