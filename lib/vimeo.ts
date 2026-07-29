/**
 * Vimeo API client for the Thumb Manager.
 * Token comes from the VIMEO_TOKEN environment variable — never hardcoded.
 * Server-only: never import this from a client component.
 */

const API_BASE = "https://api.vimeo.com";

export interface VimeoFolder {
  id: string;
  name: string;
  parent_id: string | null;
  video_count: number;
}

export interface VimeoVideo {
  id: string;
  uri: string;
  name: string;
  duration: number;
  transcode_status: string | null;
  thumb_url: string | null;
}

export interface VimeoPicture {
  id: string;
  uri: string;
  active: boolean;
  type: string;
  thumb_url: string | null;
}

export interface VimeoPictureRaw {
  uri?: string;
  active?: boolean;
  type?: string;
  sizes?: Array<{ width?: number; link?: string }>;
}

export interface VimeoTextTrack {
  id: number | string | null;
  uri: string;
  language: string;
  name: string;
  type: string;
  active: boolean;
}

export interface VimeoTrackRaw {
  id?: number | string;
  uri?: string;
  language?: string;
  name?: string;
  type?: string;
  active?: boolean;
  link?: string;
  source_link?: string;
}

interface PagingBody<T> {
  data?: T[];
  paging?: { next?: string | null };
}

function getToken(): string {
  const token = process.env.VIMEO_TOKEN;
  if (!token) {
    throw new VimeoError("VIMEO_TOKEN no seteado en el servidor.", 503);
  }
  return token;
}

export class VimeoError extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "VimeoError";
    this.status = status;
  }
}

/**
 * Low-level fetch wrapper with rate-limit backoff.
 * On 429, sleeps X-RateLimit-Reset-Delta seconds and retries once.
 */
export async function vimeoFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getToken();
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `bearer ${token}`);
  headers.set("Accept", "application/vnd.vimeo.*+json;version=3.4");
  headers.set("User-Agent", "panel-mm-thumb-manager/1.0");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response = await fetch(url, { ...init, headers });
  if (response.status === 429) {
    const wait = Number(response.headers.get("X-RateLimit-Reset-Delta") ?? "60");
    await new Promise((r) => setTimeout(r, Math.max(1, wait) * 1000));
    response = await fetch(url, { ...init, headers });
  }
  return response;
}

async function vimeoJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await vimeoFetch(path, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new VimeoError(`Vimeo API ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  return (await res.json()) as T;
}

async function* paginate<T>(
  path: string,
  params: Record<string, string | number> = {},
): AsyncGenerator<T> {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries({ per_page: 100, ...params })) {
    query.set(k, String(v));
  }
  let url: string | null = `${API_BASE}${path}?${query.toString()}`;
  while (url) {
    const body: PagingBody<T> = await vimeoJson(url);
    for (const item of body.data ?? []) yield item;
    const nxt = body.paging?.next;
    url = nxt ? `${API_BASE}${nxt}` : null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function pickThumb(
  pic: { sizes?: Array<{ width?: number; link?: string }> } | null | undefined,
  minWidth = 200,
): string | null {
  const sizes = pic?.sizes ?? [];
  if (!sizes.length) return null;
  const sorted = [...sizes].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const t = sorted.find((s) => (s.width ?? 0) >= minWidth) ?? sorted[sorted.length - 1];
  return t.link ?? null;
}

/**
 * Convert SRT text to WebVTT.
 * Handles malformed SRTs where blank lines appear between every line of a cue
 * (a faster-whisper artifact), not just between cues.
 */
export function normalizeSrt(content: string): string {
  let text = content.replace(/^\ufeff/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");

  const rawBlocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const cues: Array<{ timestamp: string; textParts: string[] }> = [];
  let i = 0;
  while (i < rawBlocks.length) {
    const block = rawBlocks[i];
    if (!block.includes("-->")) {
      i += 1;
      continue;
    }
    const blockLines = block.split("\n");
    const tsIdx = blockLines.findIndex((l) => l.includes("-->"));
    if (tsIdx === -1) {
      i += 1;
      continue;
    }
    const timestamp = blockLines[tsIdx];
    const textParts = blockLines
      .slice(tsIdx + 1)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let j = i + 1;
    while (j < rawBlocks.length) {
      const nb = rawBlocks[j];
      if (nb.includes("-->")) break;
      if (/^\d+$/.test(nb) && j + 1 < rawBlocks.length && rawBlocks[j + 1].includes("-->")) break;
      textParts.push(nb);
      j += 1;
    }
    cues.push({ timestamp, textParts });
    i = j;
  }

  const outCues = cues.map(
    ({ timestamp, textParts }, idx) =>
      `${idx + 1}\n${timestamp}\n${textParts.join("\n")}`,
  );
  return `WEBVTT\n\n${outCues.join("\n\n")}\n`;
}

// ── Folders ────────────────────────────────────────────────────────────────

interface RawFolder {
  uri?: string;
  name?: string;
  metadata?: {
    connections?: {
      parent_folder?: { uri?: string };
      videos?: { total?: number };
    };
  };
}

export async function getAllFolders(): Promise<VimeoFolder[]> {
  const fields =
    "uri,name,metadata.connections.parent_folder,metadata.connections.videos.total";
  const out: VimeoFolder[] = [];
  for await (const f of paginate<RawFolder>("/me/projects", { fields })) {
    const uri = f.uri ?? "";
    const id = uri.split("/").pop() ?? "";
    if (!id) continue;
    const parentUri = f.metadata?.connections?.parent_folder?.uri ?? "";
    const parentId = parentUri ? (parentUri.split("/").pop() ?? null) : null;
    out.push({
      id,
      name: f.name ?? "",
      parent_id: parentId,
      video_count: f.metadata?.connections?.videos?.total ?? 0,
    });
  }
  return out;
}

// ── Videos ─────────────────────────────────────────────────────────────────

interface RawVideo {
  uri?: string;
  name?: string;
  duration?: number;
  transcode?: { status?: string };
  pictures?: { sizes?: Array<{ width?: number; link?: string }> };
}

export async function getFolderVideos(folderId: string): Promise<VimeoVideo[]> {
  const fields = "uri,name,duration,transcode.status,pictures";
  const out: VimeoVideo[] = [];
  for await (const v of paginate<RawVideo>(`/me/projects/${folderId}/videos`, { fields })) {
    const uri = v.uri ?? "";
    const tail = uri.split("/").pop() ?? "";
    const vid = tail.split(":")[0];
    if (!vid) continue;
    out.push({
      id: vid,
      uri,
      name: v.name ?? "",
      duration: v.duration ?? 0,
      transcode_status: v.transcode?.status ?? null,
      thumb_url: pickThumb(v.pictures ?? null, 200),
    });
  }
  return out;
}

// ── Pictures ───────────────────────────────────────────────────────────────

interface RawPicturesList {
  data?: VimeoPictureRaw[];
}

export async function getVideoPictures(videoId: string): Promise<VimeoPicture[]> {
  const res = await vimeoFetch(`/videos/${videoId}/pictures`);
  if (!res.ok) return [];
  const body = (await res.json()) as RawPicturesList;
  return (body.data ?? []).map((p) => ({
    id: (p.uri ?? "").split("/").pop() ?? "",
    uri: p.uri ?? "",
    active: p.active ?? false,
    type: p.type ?? "",
    thumb_url: pickThumb(p, 600),
  }));
}

export async function createPicture(
  videoId: string,
  timeSeconds: number,
  active = false,
): Promise<VimeoPictureRaw> {
  const payload: { time: number; active?: boolean } = { time: Number(timeSeconds) };
  if (active) payload.active = true;
  const res = await vimeoFetch(`/videos/${videoId}/pictures`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (res.status !== 200 && res.status !== 201) {
    const text = await res.text().catch(() => "");
    throw new VimeoError(`create_picture ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  return (await res.json()) as VimeoPictureRaw;
}

export async function activatePicture(picUri: string): Promise<void> {
  const res = await vimeoFetch(picUri, {
    method: "PATCH",
    body: JSON.stringify({ active: true }),
  });
  if (res.status !== 200 && res.status !== 204) {
    const text = await res.text().catch(() => "");
    throw new VimeoError(`activate_picture ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
}

export async function deletePicture(picUri: string): Promise<boolean> {
  const res = await vimeoFetch(picUri, { method: "DELETE" });
  return res.status === 200 || res.status === 204;
}

// ── Text tracks ────────────────────────────────────────────────────────────

export async function getVideoTracks(videoId: string): Promise<VimeoTextTrack[]> {
  const res = await vimeoFetch(`/videos/${videoId}/texttracks`);
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: VimeoTrackRaw[] };
  return (body.data ?? []).map((t) => ({
    id: t.id ?? null,
    uri: t.uri ?? "",
    language: t.language ?? "",
    name: t.name ?? "",
    type: t.type ?? "",
    active: t.active ?? false,
  }));
}

export async function createTrack(
  videoId: string,
  language: string,
  name: string,
  trackType = "subtitles",
): Promise<VimeoTrackRaw> {
  const res = await vimeoFetch(`/videos/${videoId}/texttracks`, {
    method: "POST",
    body: JSON.stringify({ type: trackType, language, name }),
  });
  if (res.status !== 200 && res.status !== 201) {
    const text = await res.text().catch(() => "");
    throw new VimeoError(`create_track ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  return (await res.json()) as VimeoTrackRaw;
}

/**
 * Upload SRT content to the URL returned by createTrack.
 * The upload URL is on a different host (files.vimeo / storage) and does NOT
 * take the Authorization header — we use plain fetch here.
 */
export async function uploadTrackContent(
  uploadUrl: string,
  srtContent: string,
): Promise<void> {
  const normalized = normalizeSrt(srtContent);
  const put = await fetch(uploadUrl, {
    method: "PUT",
    body: normalized,
    headers: { "Content-Type": "text/plain" },
  });
  let final: Response = put;
  if (put.status === 405) {
    final = await fetch(uploadUrl, {
      method: "POST",
      body: normalized,
      headers: { "Content-Type": "text/plain" },
    });
  }
  if (final.status !== 200 && final.status !== 201 && final.status !== 204) {
    const text = await final.text().catch(() => "");
    throw new VimeoError(
      `upload_track ${final.status}: ${text.slice(0, 200)}`,
      final.status,
    );
  }
}

export async function deleteTrack(trackUri: string): Promise<boolean> {
  const res = await vimeoFetch(trackUri, { method: "DELETE" });
  return res.status === 200 || res.status === 204;
}
