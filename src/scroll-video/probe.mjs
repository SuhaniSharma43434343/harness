import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { aspectRatio } from '../../skills/app02/recipes/lib/scroll-video-core.js';

// Reads what a scroll video needs to know from an MP4 or WebM file without ffprobe: duration,
// frame size, rotation, codec, frame rate, keyframe spacing (the thing that decides whether
// scrubbing is smooth), fast start, cues and audio. It reads box and element headers only;
// for MP4 only the moov box is loaded, for WebM up to WEBM_SCAN_BYTES.
//
// probeFile(file) => {
//   container: 'mp4'|'webm', brand, durationS, width, height, rotation, aspectRatio, fps,
//   frameCount, codec ('h264'|'hevc'|'vp8'|'vp9'|'av1'|'prores'|...), codecId, hasAudio, bytes,
//   bitrateKbps, keyframes, keyframeIntervalS (largest gap), keyframeIntervalAvgS, allIntra,
//   fastStart (mp4), fragmented (mp4), hasCues (webm), hasDuration, issues[]
// }

export const WEBM_SCAN_BYTES = 256 * 1024 * 1024;

const CODECS = {
  avc1: 'h264', avc3: 'h264', hvc1: 'hevc', hev1: 'hevc', vp08: 'vp8', vp09: 'vp9', av01: 'av1',
  apcn: 'prores', apch: 'prores', apcs: 'prores', apco: 'prores', ap4h: 'prores', ap4x: 'prores', mp4v: 'mpeg4', 'mjpa': 'mjpeg', jpeg: 'mjpeg',
  V_VP8: 'vp8', V_VP9: 'vp9', V_AV1: 'av1', 'V_MPEG4/ISO/AVC': 'h264', 'V_MPEGH/ISO/HEVC': 'hevc', V_PRORES: 'prores',
};

const r3 = (v) => Math.round(v * 1000) / 1000;

function readAt(fd, offset, length) {
  const buf = Buffer.alloc(length);
  const n = readSync(fd, buf, 0, length, offset);
  return n === length ? buf : buf.subarray(0, n);
}

// What kind of file this is, from its first bytes.
export function sniff(head) {
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  if (head.length >= 8 && ['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip'].includes(head.toString('latin1', 4, 8))) return 'mp4';
  return null;
}

export function probeFile(file) {
  if (!existsSync(file)) throw new Error(`There is no video at ${file}`);
  const bytes = statSync(file).size;
  const fd = openSync(file, 'r');
  try {
    const head = readAt(fd, 0, 16);
    const kind = sniff(head);
    if (kind === 'mp4') return finish(probeMp4(fd, bytes), bytes);
    if (kind === 'webm') return finish(probeWebm(readAt(fd, 0, Math.min(bytes, WEBM_SCAN_BYTES)), bytes), bytes);
    throw Object.assign(new Error('This is not an MP4 or WebM file. Export the video as MP4 (H.264) or WebM (VP9).'), { code: 'UNSUPPORTED_CONTAINER' });
  } finally {
    closeSync(fd);
  }
}

function finish(info, bytes) {
  info.bytes = bytes;
  info.bitrateKbps = info.durationS > 0 ? Math.round((bytes * 8) / info.durationS / 1000) : null;
  if (info.rotation === 90 || info.rotation === 270) [info.width, info.height] = [info.height, info.width];
  info.aspectRatio = aspectRatio(info.width, info.height);
  if (!info.fps && info.frameCount && info.durationS) info.fps = r3(info.frameCount / info.durationS);
  if (info.fps) info.fps = Math.round(info.fps * 100) / 100;
  const kt = info.keyframeTimes ?? [];
  delete info.keyframeTimes;
  info.keyframes = kt.length || info.keyframes || 0;
  if (info.allIntra) {
    info.keyframeIntervalS = info.fps ? r3(1 / info.fps) : 0;
    info.keyframeIntervalAvgS = info.keyframeIntervalS;
  } else if (kt.length) {
    const gaps = kt.map((t, i) => (i ? t - kt[i - 1] : 0)).slice(1);
    gaps.push(Math.max(0, info.durationS - kt[kt.length - 1]));
    info.keyframeIntervalS = r3(Math.max(...gaps));
    info.keyframeIntervalAvgS = r3(info.durationS / kt.length);
  } else {
    info.keyframeIntervalS = null;
    info.keyframeIntervalAvgS = null;
  }
  info.durationS = r3(info.durationS);
  return info;
}

// ---------------- MP4 (ISO BMFF) ----------------

function* boxes(buf, start = 0, end = buf.length) {
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) size = end - pos;
    if (size < header || pos + size > end) return;
    yield { type, start: pos, data: pos + header, end: pos + size };
    pos += size;
  }
}
const child = (buf, box, type) => [...boxes(buf, box.data, box.end)].find((b) => b.type === type);
const path = (buf, box, ...types) => types.reduce((b, t) => (b ? child(buf, b, t) : null), box);

function probeMp4(fd, bytes) {
  // Walk the top-level boxes by their headers, loading only moov.
  const order = [];
  let moov = null;
  let brand = null;
  let pos = 0;
  while (pos + 8 <= bytes) {
    const h = readAt(fd, pos, 16);
    if (h.length < 8) break;
    let size = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    if (size === 1) size = Number(h.readBigUInt64BE(8));
    else if (size === 0) size = bytes - pos;
    if (size < 8) break;
    order.push(type);
    if (type === 'ftyp') brand = h.toString('latin1', 8, 12).trim();
    if (type === 'moov') moov = { buf: readAt(fd, pos, size), at: pos };
    pos += size;
  }
  if (!moov) throw Object.assign(new Error('The MP4 has no moov box (it may be cut short or still recording).'), { code: 'NO_MOOV' });
  const buf = moov.buf;
  const root = [...boxes(buf)][0];
  const info = { container: 'mp4', brand, issues: [], hasAudio: false, fastStart: order.indexOf('moov') < order.indexOf('mdat') || !order.includes('mdat'), fragmented: order.includes('moof') };

  const mvhd = child(buf, root, 'mvhd');
  let timescale = 1000;
  let duration = 0;
  if (mvhd) {
    const v = buf[mvhd.data];
    timescale = buf.readUInt32BE(mvhd.data + (v === 1 ? 20 : 12));
    duration = v === 1 ? Number(buf.readBigUInt64BE(mvhd.data + 24)) : buf.readUInt32BE(mvhd.data + 16);
  }
  const mehd = path(buf, root, 'mvex', 'mehd');
  if (mehd) {
    info.fragmented = true;
    const v = buf[mehd.data];
    if (!duration) duration = v === 1 ? Number(buf.readBigUInt64BE(mehd.data + 4)) : buf.readUInt32BE(mehd.data + 4);
  }
  info.durationS = timescale ? duration / timescale : 0;
  info.hasDuration = info.durationS > 0;

  for (const trak of boxes(buf, root.data, root.end)) {
    if (trak.type !== 'trak') continue;
    const hdlr = path(buf, trak, 'mdia', 'hdlr');
    const handler = hdlr ? buf.toString('latin1', hdlr.data + 8, hdlr.data + 12) : '';
    if (handler === 'soun') info.hasAudio = true;
    if (handler !== 'vide' || info.codec) continue;

    const tkhd = child(buf, trak, 'tkhd');
    if (tkhd) {
      const v = buf[tkhd.data];
      const m = tkhd.data + (v === 1 ? 52 : 40); // the matrix; width and height follow it
      const a = buf.readInt32BE(m) / 65536;
      const b = buf.readInt32BE(m + 4) / 65536;
      info.rotation = ((Math.round((Math.atan2(b, a) * 180) / Math.PI) % 360) + 360) % 360;
      info.width = Math.round(buf.readUInt32BE(m + 36) / 65536);
      info.height = Math.round(buf.readUInt32BE(m + 40) / 65536);
    }
    const mdhd = path(buf, trak, 'mdia', 'mdhd');
    let ts = timescale;
    let tdur = 0;
    if (mdhd) {
      const v = buf[mdhd.data];
      ts = buf.readUInt32BE(mdhd.data + (v === 1 ? 20 : 12));
      tdur = v === 1 ? Number(buf.readBigUInt64BE(mdhd.data + 24)) : buf.readUInt32BE(mdhd.data + 16);
    }
    if (!info.durationS && tdur && ts) info.durationS = tdur / ts;
    const stbl = path(buf, trak, 'mdia', 'minf', 'stbl');
    const stsd = stbl && child(buf, stbl, 'stsd');
    if (stsd) {
      const entry = stsd.data + 8;
      info.codecId = buf.toString('latin1', entry + 4, entry + 8);
      info.codec = CODECS[info.codecId] ?? info.codecId;
      if (!info.width) {
        info.width = buf.readUInt16BE(entry + 32);
        info.height = buf.readUInt16BE(entry + 34);
      }
    }
    // Sample timing: frame count, frame rate, and the time of every sample for keyframes.
    const stts = stbl && child(buf, stbl, 'stts');
    const deltas = [];
    if (stts) {
      const n = buf.readUInt32BE(stts.data + 4);
      let frames = 0;
      let total = 0;
      for (let i = 0; i < n; i++) {
        const count = buf.readUInt32BE(stts.data + 8 + i * 8);
        const delta = buf.readUInt32BE(stts.data + 12 + i * 8);
        frames += count;
        total += count * delta;
        deltas.push([count, delta]);
      }
      info.frameCount = frames;
      if (total && ts) info.fps = frames / (total / ts);
    }
    const stss = stbl && child(buf, stbl, 'stss');
    if (!stss) {
      if (info.frameCount) info.allIntra = true;
    } else {
      const n = buf.readUInt32BE(stss.data + 4);
      const samples = [];
      for (let i = 0; i < n; i++) samples.push(buf.readUInt32BE(stss.data + 8 + i * 4));
      // Sample number (1-based) to time through the stts runs.
      const timeOf = (sample) => {
        let left = sample - 1;
        let t = 0;
        for (const [count, delta] of deltas) {
          const take = Math.min(left, count);
          t += take * delta;
          left -= take;
          if (!left) break;
        }
        return t / ts;
      };
      info.keyframeTimes = samples.map(timeOf);
      info.allIntra = info.frameCount > 0 && n >= info.frameCount;
    }
  }
  if (!info.codec) throw Object.assign(new Error('The file has no video track.'), { code: 'NO_VIDEO' });
  if (info.fragmented) info.issues.push('fragmented');
  if (!info.fastStart) info.issues.push('no-fast-start');
  return info;
}

// ---------------- WebM / Matroska (EBML) ----------------

const ID = {
  EBML: 0x1a45dfa3, DocType: 0x4282, Segment: 0x18538067, SeekHead: 0x114d9b74, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83, CodecID: 0x86, DefaultDuration: 0x23e383, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba,
  Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, ReferenceBlock: 0xfb, Cues: 0x1c53bb6b, Tags: 0x1254c367, Chapters: 0x1043a770, Attachments: 0x1941a469,
};
const LEVEL1 = new Set([ID.SeekHead, ID.Info, ID.Tracks, ID.Cluster, ID.Cues, ID.Tags, ID.Chapters, ID.Attachments]);

function vint(buf, pos, keepMarker = false) {
  const first = buf[pos];
  if (first === undefined) return null;
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && !(first & mask)) {
    mask >>= 1;
    len++;
  }
  if (len > 8 || pos + len > buf.length) return null;
  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[pos + i];
    if (buf[pos + i] !== 0xff) allOnes = false;
  }
  return { value, length: len, unknown: !keepMarker && allOnes };
}

const uint = (buf, pos, len) => {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + buf[pos + i];
  return v;
};
const float = (buf, pos, len) => (len === 4 ? buf.readFloatBE(pos) : len === 8 ? buf.readDoubleBE(pos) : 0);

// Reads one element header at pos: { id, size, data, end } (end clipped to the buffer).
function element(buf, pos, limit) {
  const id = vint(buf, pos, true);
  if (!id) return null;
  const size = vint(buf, pos + id.length);
  if (!size) return null;
  const data = pos + id.length + size.length;
  return { id: id.value, data, end: size.unknown ? limit : Math.min(limit, data + size.value), unknown: size.unknown };
}

function probeWebm(buf, bytes) {
  const info = { container: 'webm', issues: [], hasAudio: false, hasCues: false, truncatedScan: bytes > buf.length };
  let scale = 1e6;
  let durationTicks = null;
  let videoTrack = null;
  let defaultDuration = null;
  const keyTimes = [];
  let frames = 0;
  let lastTime = 0;

  const top = element(buf, 0, buf.length);
  if (!top || top.id !== ID.EBML) throw Object.assign(new Error('Not a WebM file.'), { code: 'UNSUPPORTED_CONTAINER' });
  for (let p = top.data; p < top.end; ) {
    const e = element(buf, p, top.end);
    if (!e) break;
    if (e.id === ID.DocType) info.brand = buf.toString('latin1', e.data, e.end);
    p = e.end;
  }
  let pos = top.end;
  while (pos < buf.length) {
    const seg = element(buf, pos, buf.length);
    if (!seg) break;
    if (seg.id !== ID.Segment) {
      pos = seg.end;
      continue;
    }
    for (let p = seg.data; p < seg.end; ) {
      const e = element(buf, p, seg.end);
      if (!e) break;
      if (e.id === ID.Info) {
        for (let q = e.data; q < e.end; ) {
          const c = element(buf, q, e.end);
          if (!c) break;
          if (c.id === ID.TimecodeScale) scale = uint(buf, c.data, c.end - c.data);
          if (c.id === ID.Duration) durationTicks = float(buf, c.data, c.end - c.data);
          q = c.end;
        }
      } else if (e.id === ID.Tracks) {
        for (let q = e.data; q < e.end; ) {
          const t = element(buf, q, e.end);
          if (!t) break;
          if (t.id === ID.TrackEntry) {
            const tr = {};
            for (let r = t.data; r < t.end; ) {
              const c = element(buf, r, t.end);
              if (!c) break;
              const len = c.end - c.data;
              if (c.id === ID.TrackNumber) tr.number = uint(buf, c.data, len);
              if (c.id === ID.TrackType) tr.type = uint(buf, c.data, len);
              if (c.id === ID.CodecID) tr.codec = buf.toString('latin1', c.data, c.end);
              if (c.id === ID.DefaultDuration) tr.defaultDuration = uint(buf, c.data, len);
              if (c.id === ID.Video) {
                for (let s = c.data; s < c.end; ) {
                  const v = element(buf, s, c.end);
                  if (!v) break;
                  if (v.id === ID.PixelWidth) tr.width = uint(buf, v.data, v.end - v.data);
                  if (v.id === ID.PixelHeight) tr.height = uint(buf, v.data, v.end - v.data);
                  s = v.end;
                }
              }
              r = c.end;
            }
            if (tr.type === 2) info.hasAudio = true;
            if (tr.type === 1 && !videoTrack) {
              videoTrack = tr;
              defaultDuration = tr.defaultDuration ?? null;
            }
          }
          q = t.end;
        }
      } else if (e.id === ID.Cues) info.hasCues = true;
      else if (e.id === ID.Cluster) {
        let clusterTime = 0;
        let end = e.end;
        for (let q = e.data; q < end; ) {
          const c = element(buf, q, end);
          if (!c) break;
          // An unknown-size cluster (a live recording) ends where the next top-level element starts.
          if (e.unknown && (LEVEL1.has(c.id) || c.id === ID.Cluster)) {
            end = q;
            break;
          }
          if (c.id === ID.Timecode) clusterTime = uint(buf, c.data, c.end - c.data);
          else if (c.id === ID.SimpleBlock || c.id === ID.BlockGroup) {
            let block = c;
            let key = true;
            if (c.id === ID.BlockGroup) {
              block = null;
              for (let r = c.data; r < c.end; ) {
                const g = element(buf, r, c.end);
                if (!g) break;
                if (g.id === ID.Block) block = g;
                if (g.id === ID.ReferenceBlock) key = false;
                r = g.end;
              }
            }
            if (block) {
              const track = vint(buf, block.data);
              if (videoTrack && track && track.value === videoTrack.number) {
                const rel = buf.readInt16BE(block.data + track.length);
                const t = clusterTime + rel;
                if (c.id === ID.SimpleBlock) key = Boolean(buf[block.data + track.length + 2] & 0x80);
                frames++;
                lastTime = Math.max(lastTime, t);
                if (key) keyTimes.push((t * scale) / 1e9);
              }
            }
          }
          q = c.end;
        }
        p = end;
        continue;
      }
      p = e.end;
    }
    break;
  }
  if (!videoTrack) throw Object.assign(new Error('The file has no video track.'), { code: 'NO_VIDEO' });
  info.codecId = videoTrack.codec;
  info.codec = CODECS[videoTrack.codec] ?? videoTrack.codec;
  info.width = videoTrack.width;
  info.height = videoTrack.height;
  info.rotation = 0;
  info.frameCount = frames || null;
  const frameS = defaultDuration ? defaultDuration / 1e9 : null;
  info.hasDuration = durationTicks !== null && durationTicks > 0;
  if (info.hasDuration) info.durationS = (durationTicks * scale) / 1e9;
  else info.durationS = frames ? (lastTime * scale) / 1e9 + (frameS ?? 1 / 30) : 0;
  if (frameS) info.fps = 1 / frameS;
  else if (frames > 1 && info.durationS) info.fps = frames / info.durationS;
  info.keyframeTimes = keyTimes.sort((a, b) => a - b);
  info.allIntra = frames > 0 && keyTimes.length >= frames;
  if (!info.hasDuration) info.issues.push('no-duration');
  if (!info.hasCues) info.issues.push('no-cues');
  if (info.truncatedScan) info.issues.push('scan-truncated');
  return info;
}
