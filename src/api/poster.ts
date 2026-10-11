/**
 * Fetches a TMDB poster as a data URL. The streaming sites' content-security policies may block
 * image.tmdb.org, so the background fetches it and hands the pixels to the page.
 */
export async function fetchPosterDataUrl(
  path: string,
  size = 'w185',
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): Promise<string | null> {
  // TMDB poster paths look like /abc123.jpg. Refuse anything else so this cannot fetch arbitrary URLs.
  if (!/^\/[\w.-]+$/.test(path)) return null;
  const res = await fetchFn('https://image.tmdb.org/t/p/' + size + path);
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return 'data:' + (res.headers.get('content-type') ?? 'image/jpeg') + ';base64,' + btoa(binary);
}
