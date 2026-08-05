// These regex patterns are used that the proxy can identify which urls should be streamed.
// by default the most common video files are included in the @omss/framework

export const streamPatterns: RegExp[] = [
    /pixeldrain\.dev|pixeldra\.in/,
    /hub\.(raj\.lat|toxix\.buzz|oreao-cdn\.buzz)/,
    /wasabisys\.com/,
    /hakunaymatata\.com/,
    /streamflixserver\.site|tripplestream\.online/,
    /illimitableinkwell\.site/,
    /frostcomet5\.pro/,
    /(epimetheus63|earth14|pandora20)\.workers\.dev/, // streammafia's workers.dev proxy domains
    /tiktokcdn\.com/,
    // VaPlayer's CDN disguises MPEG-TS segments as page-N.html and appends
    // a token query string. Match the query too, otherwise the framework
    // buffers the entire segment before handing it to hls.js.
    /\/content\/[^?\s]+\/page-\d+\.html(?:\?|$)/,
    /trendimovies\.com\/tgstream\/stream/,
    // MegaPlay (anime provider) disguises its video segments with fake extensions
    // (.jpg/.html/.js/.css/.txt/.png/.webp/...) so the default .ts/.mp4 extension
    // check never matches them, which was sending every segment through the
    // buffered proxy path (full download before forwarding) instead of streaming
    // it — the main cause of anime playback buffering. Match by CDN host instead
    // of extension since the fake extension varies per segment.
    /\.(mewstream|sparkora)\.buzz/,
    // AnimeCurx proxy serves MPEG-TS segments via /api/proxy/hls?url=...page-N.html...
    // Segments are ~150KB and must stream. Manifests (.m3u8) must NOT match here —
    // they go through the buffered path so OMSS can rewrite variant/segment URLs.
    /embed\.animecurx\.tech.*\.html/,
    // MegaPlay's CDN (megap.kotocdn.site) serves MPEG-TS segments disguised as
    // PNG files at /segment/<token> — no extension, content-type: image/png.
    // Segments are ~1.1 MB each; buffering the full body before forwarding causes
    // a multi-second freeze at 0:00. Stream them so hls.js receives bytes
    // immediately. Manifests come from a different path (/index-*.m3u8) so this
    // pattern won't interfere with URL rewriting.
    /kotocdn\.site\/segment/,
    // NOTE: 4Animo (cdn.4animo.xyz) serves BOTH manifests and segments at
    // /p?t=<token> — identical URL shape. Adding a stream pattern here would
    // make the proxy pipe manifests as raw bytes without rewriting the variant
    // URLs, which causes hls.js to fetch variants directly from the CDN → 403.
    // 4Animo manifests respond with content-type: application/vnd.apple.mpegurl
    // so the buffered path (handleBufferedRequest) correctly rewrites them.
    // Segments are chunked (~1.6 MB, ~11 s each) and are buffered too — the extra
    // latency is acceptable compared to the alternative of broken playback.
];
