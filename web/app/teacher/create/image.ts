/** 사진을 긴 쪽 2000px 이하 JPEG로 줄여 base64로 (올리는 시간과 서버 한도를 위해) */
export async function shrinkImage(file: File, max = 2000): Promise<{ b64: string; url: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const url = canvas.toDataURL("image/jpeg", 0.88);
  return { b64: url.slice(url.indexOf(",") + 1), url };
}
