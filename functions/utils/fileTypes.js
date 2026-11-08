// Allowlist of extensions the image host accepts and serves inline.
// Anything not listed here is rejected on upload and, if an older upload
// already exists, served only as a download (see file/[id].js).
// SVG is deliberately absent: it can carry scripts.

export const ALLOWED_TYPES = {
    // images
    jpg: { category: 'image', mime: 'image/jpeg' },
    jpeg: { category: 'image', mime: 'image/jpeg' },
    png: { category: 'image', mime: 'image/png' },
    gif: { category: 'image', mime: 'image/gif' },
    webp: { category: 'image', mime: 'image/webp' },
    avif: { category: 'image', mime: 'image/avif' },
    bmp: { category: 'image', mime: 'image/bmp' },
    ico: { category: 'image', mime: 'image/x-icon' },
    heic: { category: 'image', mime: 'image/heic' },
    heif: { category: 'image', mime: 'image/heif' },
    tif: { category: 'image', mime: 'image/tiff' },
    tiff: { category: 'image', mime: 'image/tiff' },
    // video
    mp4: { category: 'video', mime: 'video/mp4' },
    m4v: { category: 'video', mime: 'video/mp4' },
    webm: { category: 'video', mime: 'video/webm' },
    mov: { category: 'video', mime: 'video/quicktime' },
    mkv: { category: 'video', mime: 'video/x-matroska' },
    // audio
    mp3: { category: 'audio', mime: 'audio/mpeg' },
    m4a: { category: 'audio', mime: 'audio/mp4' },
    aac: { category: 'audio', mime: 'audio/aac' },
    ogg: { category: 'audio', mime: 'audio/ogg' },
    oga: { category: 'audio', mime: 'audio/ogg' },
    opus: { category: 'audio', mime: 'audio/ogg' },
    wav: { category: 'audio', mime: 'audio/wav' },
    flac: { category: 'audio', mime: 'audio/flac' },
};

// Returns the lower-cased extension, or '' when the name has none
// ("a816" -> '', ".png" -> '', "x.PNG" -> 'png').
export function extensionOf(fileName) {
    if (typeof fileName !== 'string') return '';
    const base = fileName.split('/').pop();
    const dot = base.lastIndexOf('.');
    if (dot <= 0 || dot === base.length - 1) return '';
    return base.slice(dot + 1).toLowerCase();
}

export function typeForExtension(ext) {
    return Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, ext) ? ALLOWED_TYPES[ext] : null;
}
