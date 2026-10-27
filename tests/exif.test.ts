import { describe, expect, it } from "vitest";
import { readExif } from "../src/capture/exif.js";

/** Builds a SYNTHETIC little-endian JPEG/EXIF block with GPS, direction and focal length. */
function syntheticJpeg(): ArrayBuffer {
  const tiff: number[] = [];
  const u16 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  // Header: II, 42, IFD0 at 8.
  tiff.push(0x49, 0x49);
  u16(42);
  u32(8);
  // IFD0 at 8: 2 entries (ExifIFD pointer, GPS pointer), next IFD 0.
  const ifd0 = 8;
  const exifIfd = ifd0 + 2 + 2 * 12 + 4; // 38
  const gpsIfd = exifIfd + 2 + 1 * 12 + 4; // 56
  const data = gpsIfd + 2 + 5 * 12 + 4; // 122
  u16(2);
  u16(0x8769); u16(4); u32(1); u32(exifIfd);
  u16(0x8825); u16(4); u32(1); u32(gpsIfd);
  u32(0);
  // Exif IFD: FocalLengthIn35mmFilm = 26.
  u16(1);
  u16(0xa405); u16(3); u32(1); u16(26); u16(0);
  u32(0);
  // GPS IFD: LatRef N, Lat, LonRef E, Lon, ImgDirection.
  const latAt = data;
  const lonAt = data + 24;
  const dirAt = data + 48;
  u16(5);
  u16(0x0001); u16(2); u32(2); tiff.push(0x4e, 0, 0, 0);
  u16(0x0002); u16(5); u32(3); u32(latAt);
  u16(0x0003); u16(2); u32(2); tiff.push(0x45, 0, 0, 0);
  u16(0x0004); u16(5); u32(3); u32(lonAt);
  u16(0x0011); u16(5); u32(1); u32(dirAt);
  u32(0);
  const rational = (n: number, d: number) => {
    u32(n);
    u32(d);
  };
  rational(37, 1); rational(30, 1); rational(1800, 100); // 37°30'18"
  rational(127, 1); rational(0, 1); rational(3600, 100); // 127°0'36"
  rational(12345, 100); // 123.45°
  const app1 = [0xff, 0xe1, 0, 0, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length - 2;
  app1[2] = (len >> 8) & 0xff;
  app1[3] = len & 0xff;
  return new Uint8Array([0xff, 0xd8, ...app1, 0xff, 0xd9]).buffer;
}

describe("EXIF (SYNTHETIC bytes)", () => {
  it("reads position, direction and the 35 mm focal length", () => {
    const exif = readExif(syntheticJpeg());
    expect(exif.lat).toBeCloseTo(37 + 30 / 60 + 18 / 3600, 9);
    expect(exif.lon).toBeCloseTo(127 + 36 / 3600, 9);
    expect(exif.headingDeg).toBeCloseTo(123.45, 9);
    expect(exif.headingRef).toBe("T");
    expect(exif.focal35mm).toBe(26);
  });

  it("returns nothing for a file that is not a JPEG", () => {
    expect(readExif(new Uint8Array([1, 2, 3, 4]).buffer)).toEqual({});
  });
});
