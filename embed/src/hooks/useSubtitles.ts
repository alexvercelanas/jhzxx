import { useState, useEffect, useCallback, useRef } from 'react';

export interface SubtitleTrack {
  language: string;
  url: string;
}

interface Cue {
  start: number;
  end: number;
  text: string;
}

function parseTimeToSeconds(t: string): number {
  const parts = t.trim().replace(',', '.').split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(parts[0]);
}

function stripHtmlTags(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim();
}

function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.includes('-->')) {
      const [startStr, endStr] = line.split('-->');
      const start = parseTimeToSeconds(startStr);
      const end = parseTimeToSeconds(endStr.trim().split(' ')[0]);
      const textLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(stripHtmlTags(lines[i]));
        i++;
      }
      const cueText = textLines.join('\n').trim();
      if (cueText) cues.push({ start, end, text: cueText });
    }
    i++;
  }
  return cues;
}

function parseSrt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;
    const timeLine = lines.find(l => l.includes('-->'));
    if (!timeLine) continue;
    const [startStr, endStr] = timeLine.split('-->');
    const start = parseTimeToSeconds(startStr.trim());
    const end = parseTimeToSeconds(endStr.trim().split(' ')[0]);
    const textLines = lines
      .slice(lines.indexOf(timeLine) + 1)
      .map(stripHtmlTags)
      .filter(Boolean);
    const cueText = textLines.join('\n').trim();
    if (cueText) cues.push({ start, end, text: cueText });
  }
  return cues;
}

async function fetchCues(url: string): Promise<Cue[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch subtitle: ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith('WEBVTT')) return parseVtt(text);
  return parseSrt(text);
}

const OFFSET_STEP = 0.5;

export function useSubtitles(tracks: SubtitleTrack[], currentTime: number) {
  const [selectedLang, setSelectedLang] = useState<string | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!selectedLang) { setCues([]); return; }
    const track = tracks.find(t => t.language === selectedLang);
    if (!track) { setCues([]); return; }

    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    fetchCues(track.url)
      .then(parsed => { if (!ctrl.signal.aborted) { setCues(parsed); setLoading(false); } })
      .catch(() => { if (!ctrl.signal.aborted) { setCues([]); setLoading(false); } });

    return () => ctrl.abort();
  }, [selectedLang, tracks]);

  const adjustedTime = currentTime - offset;

  const activeCue = cues.find(c => adjustedTime >= c.start && adjustedTime <= c.end) ?? null;

  const adjustOffset = useCallback((delta: number) => {
    setOffset(prev => Math.round((prev + delta) * 10) / 10);
  }, []);

  const resetOffset = useCallback(() => setOffset(0), []);

  return {
    selectedLang,
    setSelectedLang,
    offset,
    adjustOffset,
    resetOffset,
    activeCueText: activeCue?.text ?? null,
    loading,
    OFFSET_STEP,
  };
}
