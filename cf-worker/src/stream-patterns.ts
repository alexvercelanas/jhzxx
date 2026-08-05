// Copied from artifacts/api-server/src/streamPatterns.ts
// URLs matching these patterns are piped (streamed) rather than buffered.

export const streamPatterns: RegExp[] = [
    /pixeldrain\.dev|pixeldra\.in/,
    /hub\.(raj\.lat|toxix\.buzz|oreao-cdn\.buzz)/,
    /wasabisys\.com/,
    /hakunaymatata\.com/,
    /streamflixserver\.site|tripplestream\.online/,
    /illimitableinkwell\.site/,
    /frostcomet5\.pro/,
    /(epimetheus63|earth14|pandora20)\.workers\.dev/,
    /tiktokcdn\.com/,
    /\/content\/[^?\s]+\/page-\d+\.html(?:\?|$)/,
    /trendimovies\.com\/tgstream\/stream/,
    /\.(mewstream|sparkora)\.buzz/,
    /embed\.animecurx\.tech.*\.html/,
    // default video extensions
    /\.mp4($|\?)/,
    /\.mkv($|\?)/,
    /\.webm($|\?)/,
    /\.avi($|\?)/,
    /\.mov($|\?)/,
];
