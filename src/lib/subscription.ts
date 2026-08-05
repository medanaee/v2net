/**
 * Decode a subscription response body (plain share links or base64, v2rayN-style).
 */
export function decodeSubscriptionBody(body: string): string {
  const trimmed = body.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return "";

  if (looksLikeShareLinks(trimmed)) {
    return trimmed;
  }

  const compact = trimmed.replace(/\s+/g, "");
  const decoded = tryBase64Decode(compact);
  if (decoded && looksLikeShareLinks(decoded)) {
    return decoded;
  }

  // Some providers wrap base64 with quotes / URI encoding
  const unquoted = compact.replace(/^["']|["']$/g, "");
  const decoded2 = tryBase64Decode(unquoted);
  if (decoded2 && looksLikeShareLinks(decoded2)) {
    return decoded2;
  }

  try {
    const uriDecoded = decodeURIComponent(trimmed);
    if (looksLikeShareLinks(uriDecoded)) return uriDecoded;
    const b64 = tryBase64Decode(uriDecoded.replace(/\s+/g, ""));
    if (b64 && looksLikeShareLinks(b64)) return b64;
  } catch {
    /* ignore */
  }

  return trimmed;
}

function looksLikeShareLinks(text: string): boolean {
  return /(?:^|\n)\s*(?:vmess|vless|trojan|ss|ssr|hysteria2?|hy2|tuic):\/\//i.test(
    text
  );
}

function tryBase64Decode(input: string): string | null {
  try {
    let s = input;
    // URL-safe base64
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4 !== 0) s += "=";
    const binary = atob(s);
    // UTF-8 decode
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}
