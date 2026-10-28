/** A small JPEG of the photo for Muse Spark Open: 1024 px on the long side is plenty to read a building or a sign. */
export function photoForModel(photo: HTMLCanvasElement, longSide = 1024): string {
  const scale = Math.min(1, longSide / Math.max(photo.width, photo.height));
  const c = document.createElement("canvas");
  c.width = Math.round(photo.width * scale);
  c.height = Math.round(photo.height * scale);
  c.getContext("2d")!.drawImage(photo, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}
