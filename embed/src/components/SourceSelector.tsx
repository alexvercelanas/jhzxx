import React from 'react';
import { Check } from 'lucide-react';


export interface Source {
  provider: { id: string; name: string } | string;
  url: string;
  quality: string;
  type: 'hls' | 'mp4';
  subtitles?: Array<{ language: string; url: string }>;
  /** Provider-declared audio tracks (e.g. ModiPlay multi-language). Used as
   *  a fallback when hls.js cannot auto-detect them from the manifest. */
  audioTracks?: Array<{ label: string; language: string }>;
}

/** Safely extract the provider display name regardless of shape */
export function providerName(provider: Source['provider']): string {
  if (typeof provider === 'string') return provider;
  return provider?.name ?? provider?.id ?? 'Unknown';
}

interface SourceSelectorProps {
  sources: Source[];
  activeProvider?: string | { id: string; name: string };
  onSelectSource: (source: Source) => void;
  isOpen: boolean;
}

export function SourceSelector({ sources, activeProvider, onSelectSource, isOpen }: SourceSelectorProps) {
  if (!isOpen) return null;

  return (
    <div className="absolute bottom-20 right-[310px] w-[260px] bg-[#0d1a12] border border-[#00e5a0]/30 rounded-xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.7)] overflow-hidden z-20 backdrop-blur-2xl">
      <div className="px-4 py-3 border-b border-white/5 bg-black/40">
        <h3 className="text-[10px] font-bold tracking-widest text-[#00e5a0] uppercase">Sources</h3>
      </div>
      <div className="flex flex-col py-1.5 max-h-[300px] overflow-y-auto">
        {sources.length === 0 ? (
          <div className="px-4 py-4 text-center text-sm text-gray-500">No sources found</div>
        ) : (
          sources.map((source) => {
            const srcName = providerName(source.provider);
            const activeName = typeof activeProvider === 'string' ? activeProvider : providerName(activeProvider as Source['provider']);
            const isActive = srcName === activeName;
            return (
              <button
                key={`${srcName}-${source.quality}`}
                onClick={() => onSelectSource(source)}
                className={`flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors relative ${
                  isActive ? 'bg-[#00e5a0]/10' : ''
                }`}
              >
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#00e5a0]" />
                )}
                <div className="flex items-center gap-2.5">
                  <span
                    className={`text-[13px] font-medium ${
                      isActive ? 'text-white' : 'text-gray-300'
                    }`}
                  >
                    {srcName}
                  </span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-[#00e5a0]/40 text-[#00e5a0] bg-[#00e5a0]/10 leading-none">
                    {source.quality}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 font-medium">Auto</span>
                  {isActive ? (
                    <Check className="w-4 h-4 text-[#00e5a0]" />
                  ) : (
                    <div className="w-4 h-4" />
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
