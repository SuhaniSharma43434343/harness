// Synthetic MP4 and WebM files, built box by box and element by element, for the container
// reader. They hold real headers and sample tables but no picture data, so they are tiny and need
// no encoder. Playable test videos come from tests/fixtures/scroll-video/make-videos.mjs.

const u32 = (...v) => {
  const b = Buffer.alloc(4 * v.length);
  v.forEach((x, i) => b.writeInt32BE(x | 0, i * 4));
  return b;
};
const u16 = (...v) => {
  const b = Buffer.alloc(2 * v.length);
  v.forEach((x, i) => b.writeUInt16BE(x, i * 2));
  return b;
};
const box = (type, ...parts) => {
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + body.length);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, body]);
};
const full = (type, version, ...parts) => box(type, Buffer.from([version, 0, 0, 0]), ...parts);

// mp4(opts) => Buffer. keyEvery: samples between keyframes (0 = no stss: every sample is a keyframe).
export function mp4({ width = 1920, height = 1080, fps = 24, frames = 240, keyEvery = 48, rotation = 0, codec = 'avc1', audio = false, fastStart = true, mdatBytes = 4096 } = {}) {
  const timescale = fps * 512;
  const delta = 512;
  const durMs = Math.round((frames / fps) * 1000);
  const matrix = rotation === 90 ? u32(0, 1 << 16, 0, -(1 << 16), 0, 0, 0, 0, 1 << 30) : u32(1 << 16, 0, 0, 0, 1 << 16, 0, 0, 0, 1 << 30);
  const tkhd = full('tkhd', 0, u32(0, 0, 1, 0, durMs), Buffer.alloc(8), u16(0, 0, 0, 0), matrix, u32(width << 16, height << 16));
  const entry = box(codec, Buffer.alloc(6), u16(1), Buffer.alloc(16), u16(width, height), Buffer.alloc(50));
  const keys = keyEvery ? Array.from({ length: Math.ceil(frames / keyEvery) }, (_, i) => i * keyEvery + 1) : [];
  const stbl = box('stbl', full('stsd', 0, u32(1), entry), full('stts', 0, u32(1, frames, delta)), ...(keyEvery ? [full('stss', 0, u32(keys.length, ...keys))] : []));
  const video = box('trak', tkhd, box('mdia', full('mdhd', 0, u32(0, 0, timescale, frames * delta), u16(0, 0)), full('hdlr', 0, u32(0), Buffer.from('vide'), Buffer.alloc(13)), box('minf', stbl)));
  const sound = box('trak', full('tkhd', 0, u32(0, 0, 2, 0, durMs), Buffer.alloc(52), u32(0, 0)), box('mdia', full('mdhd', 0, u32(0, 0, 48000, durMs * 48), u16(0, 0)), full('hdlr', 0, u32(0), Buffer.from('soun'), Buffer.alloc(13))));
  const moov = box('moov', full('mvhd', 0, u32(0, 0, 1000, durMs), Buffer.alloc(80)), video, ...(audio ? [sound] : []));
  const ftyp = box('ftyp', Buffer.from('isom'), u32(512), Buffer.from('isomavc1'));
  const mdat = box('mdat', Buffer.alloc(mdatBytes));
  return Buffer.concat(fastStart ? [ftyp, moov, mdat] : [ftyp, mdat, moov]);
}

// EBML: ids are written with their marker bits; sizes as 8-byte vints (or "unknown").
const idBuf = (id) => Buffer.from(id.toString(16).padStart(id.toString(16).length + (id.toString(16).length % 2), '0'), 'hex');
const sizeBuf = (n) => {
  const b = Buffer.alloc(8);
  b[0] = 0x01;
  b.writeUIntBE(Math.floor(n / 2 ** 24), 1, 3);
  b.writeUIntBE(n % 2 ** 24, 4, 4);
  return b;
};
const UNKNOWN = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
const el = (id, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([idBuf(id), sizeBuf(body.length), body]);
};
const open = (id, ...parts) => Buffer.concat([idBuf(id), UNKNOWN, ...parts]);
const uint = (n, bytes = 4) => {
  const b = Buffer.alloc(bytes);
  b.writeUIntBE(n, 0, bytes);
  return b;
};
const f64 = (v) => {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(v);
  return b;
};

// webm(opts) => Buffer. live: unknown sizes, no Duration and no Cues, as MediaRecorder writes them.
export function webm({ width = 1280, height = 720, fps = 25, frames = 100, keyEvery = 5, codec = 'V_VP9', audio = false, live = false, cues = true } = {}) {
  const frameMs = 1000 / fps;
  const durMs = frames * frameMs;
  const header = el(0x1a45dfa3, el(0x4286, uint(1, 1)), el(0x4282, Buffer.from('webm')));
  const info = el(0x1549a966, el(0x2ad7b1, uint(1e6, 3)), ...(live ? [] : [el(0x4489, f64(durMs))]));
  const vtrack = el(0xae, el(0xd7, uint(1, 1)), el(0x83, uint(1, 1)), el(0x86, Buffer.from(codec)), ...(live ? [] : [el(0x23e383, uint(Math.round(1e9 / fps)))]), el(0xe0, el(0xb0, uint(width, 2)), el(0xba, uint(height, 2))));
  const atrack = el(0xae, el(0xd7, uint(2, 1)), el(0x83, uint(2, 1)), el(0x86, Buffer.from('A_OPUS')));
  const tracks = el(0x1654ae6b, vtrack, ...(audio ? [atrack] : []));
  const clusters = [];
  const perCluster = Math.max(1, Math.round(fps));
  for (let c = 0; c < frames; c += perCluster) {
    const t0 = Math.round(c * frameMs);
    const blocks = [];
    for (let i = c; i < Math.min(frames, c + perCluster); i++) {
      const rel = Math.round(i * frameMs) - t0;
      const key = keyEvery ? i % keyEvery === 0 : true;
      const body = Buffer.concat([Buffer.from([0x81]), Buffer.from([(rel >> 8) & 0xff, rel & 0xff]), Buffer.from([key ? 0x80 : 0]), Buffer.alloc(16)]);
      blocks.push(el(0xa3, body));
      if (audio) blocks.push(el(0xa3, Buffer.concat([Buffer.from([0x82, 0, 0, 0x80]), Buffer.alloc(8)])));
    }
    clusters.push((live ? open : el)(0x1f43b675, el(0xe7, uint(t0)), ...blocks));
  }
  const cueEl = el(0x1c53bb6b, el(0xbb, el(0xb3, uint(0)), el(0xb7, el(0xf7, uint(1, 1)))));
  const segment = (live ? open : el)(0x18538067, info, tracks, ...clusters, ...(cues && !live ? [cueEl] : []));
  return Buffer.concat([header, segment]);
}
