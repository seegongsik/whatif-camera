/**
 * Reads the few EXIF fields an uploaded photo can contribute: where it was
 * taken, which way the camera faced, the 35 mm equivalent focal length and
 * the time. Only JPEG APP1 "Exif" blocks are read.
 */
export type PhotoExif = {
  lat?: number;
  lon?: number;
  /** GPSImgDirection in degrees, with its reference (T = true north, M = magnetic). */
  headingDeg?: number;
  headingRef?: "T" | "M";
  /** GPSHPositioningError in metres. */
  accuracyM?: number;
  focal35mm?: number;
  takenAt?: string;
};

type Reader = { u16(o: number): number; u32(o: number): number };

export function readExif(buffer: ArrayBuffer): PhotoExif {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return {};
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    const size = view.getUint16(offset + 2);
    if (marker === 0xffe1 && offset + 10 <= view.byteLength && view.getUint32(offset + 4) === 0x45786966) {
      return readTiff(view, offset + 10, size - 8);
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    offset += 2 + size;
  }
  return {};
}

function readTiff(view: DataView, start: number, length: number): PhotoExif {
  const end = Math.min(view.byteLength, start + length);
  const little = view.getUint16(start) === 0x4949;
  const r: Reader = {
    u16: (o) => view.getUint16(start + o, little),
    u32: (o) => view.getUint32(start + o, little),
  };
  const inRange = (o: number, n: number) => start + o >= start && start + o + n <= end;
  const out: PhotoExif = {};
  type Entry = { type: number; count: number; valueOffset: number; entryOffset: number };
  const entries = (ifd: number): Map<number, Entry> => {
    const map = new Map<number, Entry>();
    if (!inRange(ifd, 2)) return map;
    const n = r.u16(ifd);
    for (let i = 0; i < n; i += 1) {
      const e = ifd + 2 + i * 12;
      if (!inRange(e, 12)) break;
      map.set(r.u16(e), { type: r.u16(e + 2), count: r.u32(e + 4), valueOffset: r.u32(e + 8), entryOffset: e + 8 });
    }
    return map;
  };
  const rationals = (e: Entry | undefined): number[] => {
    if (!e || e.type !== 5) return [];
    const values: number[] = [];
    for (let i = 0; i < e.count; i += 1) {
      const o = e.valueOffset + i * 8;
      if (!inRange(o, 8)) break;
      const den = r.u32(o + 4);
      values.push(den === 0 ? NaN : r.u32(o) / den);
    }
    return values;
  };
  const ascii = (e: Entry | undefined): string | undefined => {
    if (!e || e.type !== 2) return undefined;
    const o = e.count <= 4 ? e.entryOffset : e.valueOffset;
    if (!inRange(o, e.count)) return undefined;
    let s = "";
    for (let i = 0; i < e.count; i += 1) {
      const c = view.getUint8(start + o + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const short = (e: Entry | undefined): number | undefined => (e && e.type === 3 ? r.u16(e.entryOffset) : undefined);

  const ifd0 = entries(r.u32(4));
  const exifPointer = ifd0.get(0x8769);
  if (exifPointer) {
    const exif = entries(exifPointer.valueOffset);
    const f35 = short(exif.get(0xa405));
    if (f35 && f35 > 0) out.focal35mm = f35;
    const when = ascii(exif.get(0x9003));
    const zone = ascii(exif.get(0x9011));
    const m = when && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(when);
    if (m) out.takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${zone && /^[+-]\d{2}:\d{2}$/.test(zone) ? zone : ""}`;
  }
  const gpsPointer = ifd0.get(0x8825);
  if (gpsPointer) {
    const gps = entries(gpsPointer.valueOffset);
    const dms = (v: number[]) => (v.length === 3 && v.every(Number.isFinite) ? v[0] + v[1] / 60 + v[2] / 3600 : undefined);
    const lat = dms(rationals(gps.get(0x0002)));
    const lon = dms(rationals(gps.get(0x0004)));
    if (lat !== undefined && lon !== undefined) {
      out.lat = ascii(gps.get(0x0001)) === "S" ? -lat : lat;
      out.lon = ascii(gps.get(0x0003)) === "W" ? -lon : lon;
    }
    const dir = rationals(gps.get(0x0011))[0];
    if (dir !== undefined && Number.isFinite(dir)) {
      out.headingDeg = ((dir % 360) + 360) % 360;
      out.headingRef = ascii(gps.get(0x0010)) === "M" ? "M" : "T";
    }
    const err = rationals(gps.get(0x001f))[0];
    if (err !== undefined && Number.isFinite(err) && err > 0) out.accuracyM = err;
  }
  return out;
}
