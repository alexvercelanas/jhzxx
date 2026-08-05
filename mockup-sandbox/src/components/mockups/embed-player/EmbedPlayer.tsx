import React from 'react';
import { 
  Play, 
  Pause,
  RotateCcw, 
  RotateCw, 
  Volume2, 
  Maximize2, 
  Subtitles, 
  ChevronUp, 
  Check,
  Film
} from 'lucide-react';

export default function EmbedPlayer() {
  return (
    <div className="relative w-full min-h-screen bg-[#050c08] text-white overflow-hidden font-sans select-none">
      {/* Background Image & Vignette Overlay */}
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: 'url("https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=2525&auto=format&fit=crop")',
          opacity: 0.3
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#050c08] via-transparent to-[#050c08]/80 pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-[#050c08]/50 to-[#050c08]/95 pointer-events-none" />

      {/* Top Left Title */}
      <div className="absolute top-6 left-6 flex items-center gap-2 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 shadow-lg">
        <Film className="w-4 h-4 text-white/70" />
        <span className="text-sm font-medium tracking-wide">The Dark Knight</span>
      </div>

      {/* Big Centered Play Button */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <button className="pointer-events-auto flex items-center justify-center w-24 h-24 rounded-full bg-black/60 backdrop-blur-md border-2 border-[#00e5a0] text-white hover:bg-[#00e5a0]/20 hover:scale-105 transition-all duration-300 group shadow-[0_0_40px_rgba(0,229,160,0.2)]">
          <Play className="w-10 h-10 ml-2 text-white group-hover:text-[#00e5a0] transition-colors" fill="currentColor" />
        </button>
      </div>

      {/* Loading/Buffering (Bottom Right, Above Controls) */}
      <div className="absolute bottom-20 right-6 flex items-center gap-2 bg-black/60 backdrop-blur px-3 py-1.5 rounded border border-white/5">
        <div className="w-3 h-3 border-2 border-[#00e5a0] border-t-transparent rounded-full animate-spin" />
        <span className="text-[11px] text-gray-400 font-medium">Buffering...</span>
      </div>

      {/* Sources Popover (Open State) */}
      <div className="absolute bottom-20 right-[310px] w-[260px] bg-[#0d1a12] border border-[#00e5a0]/30 rounded-xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.7)] overflow-hidden z-20 backdrop-blur-2xl">
        <div className="px-4 py-3 border-b border-white/5 bg-black/40">
          <h3 className="text-[10px] font-bold tracking-widest text-[#00e5a0] uppercase">Sources</h3>
        </div>
        <div className="flex flex-col py-1.5">
          {[
            { name: 'VidSrc', active: true, latency: '~1.2s' },
            { name: 'Videasy', active: false, latency: '~1.5s' },
            { name: 'VidApi', active: false, latency: '~1.8s' },
            { name: 'Peachify', active: false, latency: '~2.1s' },
            { name: 'VidNest', active: false, latency: '~2.4s' },
            { name: 'VidRock', active: false, latency: '~2.8s' },
          ].map((source, i) => (
            <button 
              key={source.name} 
              className={`flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors relative ${source.active ? 'bg-[#00e5a0]/10' : ''}`}
            >
              {source.active && (
                <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#00e5a0]" />
              )}
              <div className="flex items-center gap-2.5">
                <span className={`text-[13px] font-medium ${source.active ? 'text-white' : 'text-gray-300'}`}>
                  {source.name}
                </span>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-[#00e5a0]/40 text-[#00e5a0] bg-[#00e5a0]/10 leading-none">
                  HD
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 font-medium">{source.latency}</span>
                {source.active ? (
                  <Check className="w-4 h-4 text-[#00e5a0]" />
                ) : (
                  <div className="w-4 h-4" />
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Bottom Controls Bar */}
      <div className="absolute bottom-0 inset-x-0 h-16 bg-black/80 backdrop-blur-xl border-t border-white/10 flex items-center z-10 px-5">
        
        {/* Controls Layout */}
        <div className="flex items-center justify-between w-full h-full gap-6">
          
          {/* Left Controls */}
          <div className="flex items-center gap-5 shrink-0">
            <button className="text-white hover:text-[#00e5a0] transition-colors group">
              <Play className="w-[22px] h-[22px] fill-current" />
            </button>
            <div className="flex items-center gap-3">
              <button className="text-white hover:text-[#00e5a0] transition-colors opacity-80 hover:opacity-100">
                <RotateCcw className="w-[18px] h-[18px]" />
              </button>
              <button className="text-white hover:text-[#00e5a0] transition-colors opacity-80 hover:opacity-100">
                <RotateCw className="w-[18px] h-[18px]" />
              </button>
            </div>
            <div className="text-[12px] font-mono tracking-wider text-white/80 ml-2 font-medium">
              12:34 <span className="text-white/40 mx-1">/</span> 1:48:22
            </div>
          </div>
          
          {/* Center Progress */}
          <div className="flex-1 flex items-center group cursor-pointer py-4">
            <div className="w-full h-1.5 bg-white/20 rounded-full relative transition-all group-hover:h-2">
              {/* Buffer track (optional visual detail) */}
              <div className="absolute top-0 left-0 bottom-0 bg-white/10 w-[45%] rounded-full" />
              {/* Progress track */}
              <div className="absolute top-0 left-0 bottom-0 bg-[#00e5a0] w-[28%] rounded-full shadow-[0_0_10px_rgba(0,229,160,0.5)]" />
              {/* Thumb */}
              <div className="absolute top-1/2 -translate-y-1/2 left-[28%] w-3.5 h-3.5 bg-[#00e5a0] rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-[0_0_12px_rgba(0,229,160,0.8)] -ml-1.75" />
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-5 shrink-0">
            
            {/* Volume */}
            <div className="flex items-center gap-2 group cursor-pointer">
              <button className="text-white hover:text-[#00e5a0] transition-colors opacity-80 hover:opacity-100">
                <Volume2 className="w-[20px] h-[20px]" />
              </button>
              <div className="w-0 overflow-hidden group-hover:w-16 transition-all duration-300 ease-out flex items-center h-5">
                <div className="w-16 h-1.5 bg-white/20 rounded-full relative">
                  <div className="absolute inset-y-0 left-0 bg-[#00e5a0] w-[60%] rounded-full" />
                  <div className="absolute top-1/2 -translate-y-1/2 left-[60%] w-2.5 h-2.5 bg-white rounded-full -ml-1.25" />
                </div>
              </div>
            </div>

            {/* Source Selector Button */}
            <button className="flex items-center gap-2 bg-[#00e5a0]/15 hover:bg-[#00e5a0]/25 border border-[#00e5a0]/30 px-3 py-1.5 rounded transition-colors group">
              <span className="text-[12px] font-bold text-[#00e5a0] tracking-wide">VidSrc</span>
              <ChevronUp className="w-3.5 h-3.5 text-[#00e5a0] group-hover:-translate-y-0.5 transition-transform" />
            </button>

            {/* Subtitles */}
            <button className="text-white hover:text-[#00e5a0] transition-colors opacity-80 hover:opacity-100 relative">
              <Subtitles className="w-[20px] h-[20px]" />
              <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-[#00e5a0] rounded-full border-[1.5px] border-[#050c08]" />
            </button>

            {/* Quality */}
            <button className="text-[12px] font-bold text-white/80 hover:text-white transition-colors">
              1080p
            </button>

            {/* Fullscreen */}
            <button className="text-white hover:text-[#00e5a0] transition-colors opacity-80 hover:opacity-100 ml-1">
              <Maximize2 className="w-[20px] h-[20px]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
