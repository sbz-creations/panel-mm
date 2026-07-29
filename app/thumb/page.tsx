"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

// ── Types ────────────────────────────────────────────────────────────────

interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  video_count: number;
}

interface Video {
  id: string;
  uri: string;
  name: string;
  duration: number;
  transcode_status: string | null;
  thumb_url: string | null;
}

interface DryItem extends Video {
  action: "apply" | "skip";
  reason: string | null;
}

interface PendingPreview {
  pic_uri: string;
  video_id: string;
  video_name: string;
  thumb_url: string | null;
  timecode: number;
}

interface ProgressLogEntry {
  kind: "ok" | "error";
  text: string;
}

interface ProgressState {
  visible: boolean;
  title: string;
  current: number;
  total: number;
  label: string;
  log: ProgressLogEntry[];
  finished: boolean;
  ok: number;
  fail: number;
}

interface Toast {
  id: number;
  text: string;
  kind: "success" | "error" | "info";
}

interface SubRow {
  id: number;
  file: File;
  base: string;
  language: string;
  videoId: string;
}

interface SubLogEntry {
  kind: "ok" | "error";
  text: string;
}

interface SubProgressState {
  active: boolean;
  current: number;
  total: number;
  label: string;
  log: SubLogEntry[];
  finished: boolean;
}

type SubStep = "pick" | "match" | "progress";

// ── Constants ────────────────────────────────────────────────────────────

const LANG_LABELS: Record<string, string> = {
  es: "Español",
  en: "English",
  pt: "Português",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  zh: "中文",
  ja: "日本語",
  ar: "العربية",
  ko: "한국어",
  ru: "Русский",
};

// ── Utility helpers ──────────────────────────────────────────────────────

function fmtDur(seconds: number): string {
  const s = Math.floor(seconds || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function skipReason(v: Video, tc: number): string | null {
  if (v.transcode_status !== "complete") {
    return `Transcode no completo: ${v.transcode_status ?? "?"}`;
  }
  if (v.duration < tc) {
    return `Video dura ${fmtDur(v.duration)}, timecode ${tc}s`;
  }
  return null;
}

function parseSrtFilename(filename: string): { base: string; language: string } {
  let base = filename.replace(/\.(srt|vtt)$/i, "");
  let language = "es";
  const m = base.match(/_([a-z]{2})$/i);
  if (m && LANG_LABELS[m[1].toLowerCase()]) {
    language = m[1].toLowerCase();
    base = base.slice(0, -m[0].length);
  }
  return { base, language };
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bestVideoMatch(base: string, videos: Video[]): { video: Video | null; score: number } {
  const nb = normalizeName(base);
  let best: Video | null = null;
  let bestScore = 0;
  for (const v of videos) {
    const nv = normalizeName(v.name);
    let score = 0;
    if (nv === nb) {
      score = 1;
    } else if (nv.includes(nb) || nb.includes(nv)) {
      score = Math.min(nb.length, nv.length) / Math.max(nb.length, nv.length);
    } else {
      const bWords = new Set(nb.split(" ").filter((w) => w.length > 2));
      const vWords = nv.split(" ").filter((w) => w.length > 2);
      const hits = vWords.filter((w) => bWords.has(w)).length;
      if (hits > 0) score = hits / Math.max(bWords.size, vWords.length);
    }
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return { video: best, score: bestScore };
}

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? r.statusText);
  }
  return (await r.json()) as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? r.statusText);
  }
  return (await r.json()) as T;
}

// ── Component ────────────────────────────────────────────────────────────

export default function ThumbPage() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [foldersById, setFoldersById] = useState<Record<string, Folder>>({});
  const [childrenOf, setChildrenOf] = useState<Record<string, string[]>>({});
  const [rootIds, setRootIds] = useState<string[]>([]);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [foldersError, setFoldersError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [timecode, setTimecode] = useState("2.0");
  const [tcError, setTcError] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewVideo, setPreviewVideo] = useState<Video | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = useState<PendingPreview | null>(null);

  const [dryOpen, setDryOpen] = useState(false);
  const [dryItems, setDryItems] = useState<DryItem[]>([]);
  const [dryLoading, setDryLoading] = useState(false);

  const [progress, setProgress] = useState<ProgressState>({
    visible: false,
    title: "",
    current: 0,
    total: 0,
    label: "",
    log: [],
    finished: false,
    ok: 0,
    fail: 0,
  });

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  // Subtitles batch modal
  const [subOpen, setSubOpen] = useState(false);
  const [subStep, setSubStep] = useState<SubStep>("pick");
  const [subRows, setSubRows] = useState<SubRow[]>([]);
  const subRowIdRef = useRef(0);
  const [subProgress, setSubProgress] = useState<SubProgressState>({
    active: false,
    current: 0,
    total: 0,
    label: "",
    log: [],
    finished: false,
  });

  // ── Toast helpers ──
  const pushToast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToasts((prev) => [...prev, { id, text, kind }]);
    const duration = Math.max(3500, text.length * 60);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  // ── Load folders on mount ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<{ folders: Folder[] }>("/api/thumb/folders");
        if (cancelled) return;
        const byId: Record<string, Folder> = {};
        const children: Record<string, string[]> = {};
        for (const f of data.folders) {
          byId[f.id] = f;
          children[f.id] = [];
        }
        const roots: string[] = [];
        for (const f of data.folders) {
          if (f.parent_id && byId[f.parent_id]) {
            children[f.parent_id].push(f.id);
          } else {
            roots.push(f.id);
          }
        }
        const nameKey = (id: string) => (byId[id]?.name ?? "").toLowerCase();
        for (const pid of Object.keys(children)) {
          children[pid].sort((a, b) => nameKey(a).localeCompare(nameKey(b)));
        }
        roots.sort((a, b) => nameKey(a).localeCompare(nameKey(b)));
        setFolders(data.folders);
        setFoldersById(byId);
        setChildrenOf(children);
        setRootIds(roots);
        setFoldersLoaded(true);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setFoldersError(msg);
        setFoldersLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Timecode helper ──
  const getTc = useCallback((): number | null => {
    const v = parseFloat(timecode);
    if (!Number.isFinite(v) || v < 0) {
      pushToast("Timecode inválido.", "error");
      return null;
    }
    return v;
  }, [timecode, pushToast]);

  useEffect(() => {
    const v = parseFloat(timecode);
    setTcError(!Number.isFinite(v) || v < 0);
  }, [timecode]);

  // ── Folder selection ──
  const selectFolder = useCallback(
    async (folderId: string) => {
      const f = foldersById[folderId];
      if (!f) return;
      setCurrentFolderId(folderId);
      setSelected(new Set());
      setVideos([]);
      setVideosLoading(true);
      try {
        const data = await apiGet<{ videos: Video[] }>(
          `/api/thumb/folders/${folderId}/videos`,
        );
        setVideos(data.videos);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        pushToast("Error cargando videos: " + msg, "error");
      } finally {
        setVideosLoading(false);
      }
    },
    [foldersById, pushToast],
  );

  const toggleExpand = useCallback((folderId: string) => {
    setExpanded((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  }, []);

  const currentFolder = currentFolderId ? foldersById[currentFolderId] ?? null : null;

  // ── Breadcrumb chain ──
  const breadcrumbChain = useMemo(() => {
    const chain: Folder[] = [];
    let id: string | null = currentFolderId;
    while (id && foldersById[id]) {
      chain.unshift(foldersById[id]);
      id = foldersById[id].parent_id;
    }
    return chain;
  }, [currentFolderId, foldersById]);

  // ── Selection helpers ──
  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(videos.map((v) => v.id)) : new Set());
    },
    [videos],
  );

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // ── Preview flow ──
  const openPreview = useCallback(
    async (videoId: string) => {
      const v = videos.find((x) => x.id === videoId);
      if (!v) return;
      const tc = getTc();
      if (tc === null) return;
      const err = skipReason(v, tc);
      if (err) {
        pushToast(err, "error");
        return;
      }
      setPreviewVideo(v);
      setPreviewOpen(true);
      setPreviewLoading(true);
      setPreviewError(null);
      setPendingPreview(null);
      try {
        const data = await apiPost<{ pic_uri: string; thumb_url: string | null; active: boolean }>(
          "/api/thumb/preview",
          { video_id: v.id, timecode: tc },
        );
        setPendingPreview({
          pic_uri: data.pic_uri,
          video_id: v.id,
          video_name: v.name,
          thumb_url: data.thumb_url,
          timecode: tc,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setPreviewError(msg);
      } finally {
        setPreviewLoading(false);
      }
    },
    [videos, getTc, pushToast],
  );

  const discardPreview = useCallback(async () => {
    const p = pendingPreview;
    setPendingPreview(null);
    setPreviewOpen(false);
    setPreviewVideo(null);
    setPreviewError(null);
    if (p?.pic_uri) {
      try {
        await apiPost("/api/thumb/discard", { pic_uri: p.pic_uri });
      } catch {
        // silent
      }
    }
  }, [pendingPreview]);

  const confirmPreview = useCallback(async () => {
    const p = pendingPreview;
    if (!p) return;
    setPendingPreview(null);
    setPreviewOpen(false);
    setPreviewVideo(null);
    try {
      await apiPost("/api/thumb/confirm", {
        pic_uri: p.pic_uri,
        video_id: p.video_id,
        video_name: p.video_name,
        folder_id: currentFolderId ?? "",
        folder_name: currentFolder?.name ?? "",
        timecode: p.timecode,
      });
      pushToast(`Portada aplicada: ${p.video_name.slice(0, 40)}`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushToast("Error al confirmar: " + msg, "error");
    }
  }, [pendingPreview, currentFolderId, currentFolder, pushToast]);

  // ── Dry run ──
  const runDryRun = useCallback(
    async (videoIds: string[]) => {
      const tc = getTc();
      if (tc === null) return;
      if (!currentFolderId) return;
      setDryLoading(true);
      setDryOpen(true);
      try {
        const data = await apiPost<{ items: DryItem[] }>("/api/thumb/dry-run", {
          folder_id: currentFolderId,
          timecode: tc,
        });
        let items = data.items;
        if (videoIds.length > 0) {
          const set = new Set(videoIds);
          items = items.filter((i) => set.has(i.id));
        }
        setDryItems(items);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        pushToast("Error: " + msg, "error");
        setDryOpen(false);
      } finally {
        setDryLoading(false);
      }
    },
    [currentFolderId, getTc, pushToast],
  );

  // ── Batch apply (SSE) ──
  const applyBatch = useCallback(
    async (videoIds: string[]) => {
      const tc = getTc();
      if (tc === null) return;
      if (!currentFolderId || !currentFolder) return;
      const valid = videoIds.filter((id) => {
        const v = videos.find((x) => x.id === id);
        return v && !skipReason(v, tc);
      });
      if (valid.length === 0) {
        pushToast("Ningún video puede procesarse con este timecode.", "error");
        return;
      }
      setProgress({
        visible: true,
        title: `Aplicando portadas… (${valid.length} videos)`,
        current: 0,
        total: valid.length,
        label: "Iniciando…",
        log: [],
        finished: false,
        ok: 0,
        fail: 0,
      });

      let response: Response;
      try {
        response = await fetch("/api/thumb/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            video_ids: valid,
            folder_id: currentFolderId,
            folder_name: currentFolder.name,
            timecode: tc,
          }),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        pushToast("Error de red: " + msg, "error");
        setProgress((p) => ({ ...p, visible: false }));
        return;
      }

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { detail?: string } | null;
        pushToast("Error: " + (body?.detail ?? response.statusText), "error");
        setProgress((p) => ({ ...p, visible: false }));
        return;
      }

      const reader = response.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let okCount = 0;
      let failCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let evt: {
            type: string;
            total?: number;
            current?: number;
            name?: string;
            msg?: string;
            ok?: number;
            fail?: number;
          };
          try {
            evt = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (evt.type === "start") {
            setProgress((p) => ({ ...p, label: `0/${evt.total ?? 0}` }));
          } else if (evt.type === "ok") {
            okCount += 1;
            const cur = evt.current ?? 0;
            const tot = evt.total ?? valid.length;
            setProgress((p) => ({
              ...p,
              current: cur,
              total: tot,
              label: `${cur}/${tot}`,
              log: [...p.log, { kind: "ok", text: `✓ ${evt.name ?? ""}` }],
            }));
          } else if (evt.type === "error") {
            failCount += 1;
            const cur = evt.current ?? 0;
            const tot = evt.total ?? valid.length;
            setProgress((p) => ({
              ...p,
              current: cur,
              total: tot,
              label: `${cur}/${tot}`,
              log: [
                ...p.log,
                { kind: "error", text: `✗ ${evt.name ?? ""} — ${evt.msg ?? ""}` },
              ],
            }));
          } else if (evt.type === "done") {
            setProgress((p) => ({
              ...p,
              current: p.total,
              label: `Listo: ${evt.ok ?? okCount} ok, ${evt.fail ?? failCount} errores`,
              finished: true,
              ok: evt.ok ?? okCount,
              fail: evt.fail ?? failCount,
            }));
            pushToast(`${evt.ok ?? okCount} portadas aplicadas`, "success");
          }
        }
      }
    },
    [currentFolderId, currentFolder, videos, getTc, pushToast],
  );

  // ── Subtitle batch modal ──
  const openSubBatch = useCallback(() => {
    setSubOpen(true);
    setSubStep("pick");
    setSubRows([]);
    setSubProgress({
      active: false,
      current: 0,
      total: 0,
      label: "",
      log: [],
      finished: false,
    });
  }, []);

  const closeSubBatch = useCallback(() => {
    setSubOpen(false);
  }, []);

  const onSubFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const rows: SubRow[] = Array.from(files).map((file) => {
        const { base, language } = parseSrtFilename(file.name);
        const { video } = bestVideoMatch(base, videos);
        subRowIdRef.current += 1;
        return {
          id: subRowIdRef.current,
          file,
          base,
          language,
          videoId: video?.id ?? "",
        };
      });
      setSubRows(rows);
      setSubStep("match");
    },
    [videos],
  );

  const updateSubRow = useCallback((id: number, patch: Partial<SubRow>) => {
    setSubRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const removeSubRow = useCallback((id: number) => {
    setSubRows((prev) => {
      const next = prev.filter((r) => r.id !== id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (subOpen && subStep === "match" && subRows.length === 0) {
      setSubStep("pick");
    }
  }, [subOpen, subStep, subRows.length]);

  const runSubBatch = useCallback(async () => {
    const toUpload = subRows.filter((r) => r.videoId);
    if (toUpload.length === 0) return;
    setSubStep("progress");
    setSubProgress({
      active: true,
      current: 0,
      total: toUpload.length,
      label: "",
      log: [],
      finished: false,
    });
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < toUpload.length; i += 1) {
      const row = toUpload[i];
      const video = videos.find((v) => v.id === row.videoId);
      const vName = video?.name ?? row.videoId;
      setSubProgress((p) => ({
        ...p,
        current: i,
        label: `${i + 1}/${toUpload.length}: ${row.file.name}`,
      }));
      try {
        const srtContent = await row.file.text();
        const langLabel = LANG_LABELS[row.language] ?? row.language;
        await apiPost("/api/thumb/subtitles", {
          video_id: row.videoId,
          language: row.language,
          name: langLabel,
          srt_content: srtContent,
        });
        ok += 1;
        setSubProgress((p) => ({
          ...p,
          log: [
            ...p.log,
            {
              kind: "ok",
              text: `✓ ${vName} ← ${row.file.name} (${row.language})`,
            },
          ],
        }));
      } catch (err) {
        fail += 1;
        const msg = err instanceof Error ? err.message : String(err);
        setSubProgress((p) => ({
          ...p,
          log: [...p.log, { kind: "error", text: `✗ ${row.file.name} — ${msg}` }],
        }));
      }
    }
    setSubProgress((p) => ({
      ...p,
      current: toUpload.length,
      label: `Listo: ${ok} subidos${fail > 0 ? `, ${fail} errores` : ""}.`,
      finished: true,
    }));
    pushToast(`${ok} subtítulos subidos`, ok > 0 ? "success" : "error");
  }, [subRows, videos, pushToast]);

  // ── Filter for tree ──
  const searchHits = useMemo(() => {
    if (!search.trim()) return null;
    const term = search.trim().toLowerCase();
    return folders
      .filter((f) => f.name.toLowerCase().includes(term))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      .slice(0, 300);
  }, [folders, search]);

  // ── Escape handler for modals ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (subOpen) {
        closeSubBatch();
      } else if (dryOpen) {
        setDryOpen(false);
      } else if (progress.visible && progress.finished) {
        setProgress((p) => ({ ...p, visible: false }));
      } else if (previewOpen) {
        void discardPreview();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [subOpen, dryOpen, previewOpen, progress.visible, progress.finished, closeSubBatch, discardPreview]);

  // ── Render ──
  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "var(--bg)",
        color: "var(--text-primary)",
      }}
    >
      {/* Sidebar: folder tree */}
      <aside
        style={{
          width: 290,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-card)",
          borderRight: "1px solid var(--border-subtle)",
        }}
      >
        <div
          style={{
            padding: "14px 14px 10px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
              marginBottom: 10,
            }}
          >
            Thumbnail Manager
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar carpeta…"
            style={{
              width: "100%",
              padding: "7px 10px",
              fontSize: 12.5,
              background: "var(--bg)",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              outline: "none",
            }}
          />
          <div
            style={{
              fontSize: 11,
              color: "var(--text-tertiary)",
              marginTop: 8,
            }}
          >
            {!foldersLoaded
              ? "Cargando…"
              : foldersError
                ? `Error: ${foldersError}`
                : `${folders.length} carpetas`}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "8px 4px",
          }}
        >
          {searchHits
            ? searchHits.map((f) => (
                <FlatFolderNode
                  key={f.id}
                  folder={f}
                  active={currentFolderId === f.id}
                  onSelect={selectFolder}
                />
              ))
            : rootIds.map((id) => (
                <TreeNode
                  key={id}
                  id={id}
                  depth={0}
                  foldersById={foldersById}
                  childrenOf={childrenOf}
                  expanded={expanded}
                  activeId={currentFolderId}
                  onToggle={toggleExpand}
                  onSelect={selectFolder}
                />
              ))}
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 20px",
            borderBottom: "1px solid var(--border-subtle)",
            background: "var(--bg-card)",
          }}
        >
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            {breadcrumbChain.length === 0 ? (
              <span style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
                ← Seleccioná una carpeta
              </span>
            ) : (
              breadcrumbChain.map((f, i) => (
                <span key={f.id} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 13,
                      color:
                        i === breadcrumbChain.length - 1
                          ? "var(--text-primary)"
                          : "var(--text-secondary)",
                      fontWeight: i === breadcrumbChain.length - 1 ? 600 : 400,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: 220,
                    }}
                  >
                    {f.name}
                  </span>
                  {i < breadcrumbChain.length - 1 ? (
                    <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>›</span>
                  ) : null}
                </span>
              ))
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Timecode</label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={timecode}
              onChange={(e) => setTimecode(e.target.value)}
              style={{
                width: 70,
                padding: "6px 8px",
                fontSize: 12.5,
                background: "var(--bg)",
                color: "var(--text-primary)",
                border: `1px solid ${tcError ? "var(--error)" : "var(--border)"}`,
                borderRadius: 6,
                outline: "none",
              }}
            />
            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>s</span>
          </div>

          <TopButton disabled={!currentFolderId} onClick={() => runDryRun([])}>
            Dry Run
          </TopButton>
          <TopButton disabled={!currentFolderId} onClick={openSubBatch}>
            Subtítulos
          </TopButton>
          <TopButton
            variant="primary"
            disabled={!currentFolderId}
            onClick={() => {
              const tc = getTc();
              if (tc === null) return;
              const valid = videos.filter((v) => !skipReason(v, tc));
              if (valid.length === 0) {
                pushToast("Ningún video puede procesarse con este timecode.", "error");
                return;
              }
              if (!window.confirm(`Aplicar portada a ${valid.length} videos de la carpeta?`)) return;
              void applyBatch(videos.map((v) => v.id));
            }}
          >
            Aplicar todos
          </TopButton>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 24px 100px",
          }}
        >
          {!currentFolderId ? (
            <EmptyState />
          ) : (
            <FolderContent
              folder={currentFolder}
              videos={videos}
              loading={videosLoading}
              selected={selected}
              onToggle={toggleSelect}
              onSelectAll={selectAll}
              onOpenPreview={openPreview}
              childrenIds={currentFolderId ? childrenOf[currentFolderId] ?? [] : []}
              foldersById={foldersById}
              onFolderClick={selectFolder}
            />
          )}
        </div>
      </div>

      {/* Selection bar */}
      {selected.size > 0 ? (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 16px",
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 10px 30px rgba(0,0,0,.25)",
            zIndex: 40,
          }}
        >
          <span style={{ fontSize: 13, color: "var(--text-primary)" }}>
            <strong>{selected.size}</strong>{" "}
            {selected.size === 1 ? "seleccionado" : "seleccionados"}
          </span>
          <BarButton
            onClick={() => {
              if (selected.size !== 1) {
                pushToast("Seleccioná exactamente un video para previsualizar.", "error");
                return;
              }
              const [id] = Array.from(selected);
              void openPreview(id);
            }}
          >
            Preview
          </BarButton>
          <BarButton
            variant="primary"
            onClick={() => {
              if (selected.size === 0) return;
              void runDryRun(Array.from(selected));
            }}
          >
            Aplicar seleccionados
          </BarButton>
          <BarButton variant="danger" onClick={clearSelection}>
            ✕ Deseleccionar
          </BarButton>
        </div>
      ) : null}

      {/* Preview modal */}
      {previewOpen ? (
        <ModalOverlay onClose={() => void discardPreview()}>
          <ModalPanel width={720}>
            <ModalHeader onClose={() => void discardPreview()}>Preview de portada</ModalHeader>
            <div style={{ padding: 20 }}>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  marginBottom: 16,
                }}
              >
                {previewVideo?.name}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <ThumbPanel label="Portada actual">
                  {previewVideo?.thumb_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewVideo.thumb_url}
                      alt=""
                      style={{ width: "100%", display: "block" }}
                    />
                  ) : (
                    <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>Sin portada</span>
                  )}
                </ThumbPanel>
                <ThumbPanel label={`Preview (${getTc() ?? "?"}s)`}>
                  {previewLoading ? (
                    <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>Generando…</span>
                  ) : previewError ? (
                    <span style={{ color: "var(--error)", fontSize: 12 }}>{previewError}</span>
                  ) : pendingPreview?.thumb_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={pendingPreview.thumb_url}
                      alt=""
                      style={{ width: "100%", display: "block" }}
                    />
                  ) : (
                    <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
                      URL no disponible
                    </span>
                  )}
                </ThumbPanel>
              </div>
            </div>
            <ModalFooter>
              <ModalButton onClick={() => void discardPreview()}>Descartar</ModalButton>
              <ModalButton
                variant="primary"
                disabled={!pendingPreview}
                onClick={() => void confirmPreview()}
              >
                Confirmar portada
              </ModalButton>
            </ModalFooter>
          </ModalPanel>
        </ModalOverlay>
      ) : null}

      {/* Dry run modal */}
      {dryOpen ? (
        <ModalOverlay onClose={() => setDryOpen(false)}>
          <ModalPanel width={760}>
            <ModalHeader onClose={() => setDryOpen(false)}>Dry Run</ModalHeader>
            <div
              style={{
                padding: "10px 14px",
                maxHeight: "60vh",
                overflowY: "auto",
              }}
            >
              {dryLoading ? (
                <div style={{ padding: 20, color: "var(--text-tertiary)", fontSize: 13 }}>
                  Calculando…
                </div>
              ) : (
                dryItems.map((it) => (
                  <div
                    key={it.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "6px 8px",
                      borderRadius: 4,
                      fontSize: 12.5,
                      fontFamily: "var(--font-geist-mono), monospace",
                      color: "var(--text-primary)",
                    }}
                  >
                    <span
                      style={{
                        padding: "2px 7px",
                        borderRadius: 4,
                        fontSize: 10.5,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                        background:
                          it.action === "apply" ? "var(--success-subtle)" : "var(--bg-hover)",
                        color:
                          it.action === "apply" ? "var(--success)" : "var(--text-tertiary)",
                        border: `1px solid ${
                          it.action === "apply" ? "var(--success)" : "var(--border-subtle)"
                        }`,
                        flexShrink: 0,
                        width: 60,
                        textAlign: "center",
                      }}
                    >
                      {it.action}
                    </span>
                    <span
                      title={it.name}
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {it.name}
                    </span>
                    {it.reason ? (
                      <span style={{ color: "var(--text-tertiary)", fontSize: 11.5 }}>
                        — {it.reason}
                      </span>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            <ModalFooter>
              <div style={{ flex: 1, fontSize: 12.5, color: "var(--text-secondary)" }}>
                {(() => {
                  const apply = dryItems.filter((i) => i.action === "apply").length;
                  const skip = dryItems.filter((i) => i.action === "skip").length;
                  return `${apply} se aplicarían · ${skip} se saltean`;
                })()}
              </div>
              <ModalButton
                variant="primary"
                disabled={dryItems.filter((i) => i.action === "apply").length === 0}
                onClick={() => {
                  const ids = dryItems.filter((i) => i.action === "apply").map((i) => i.id);
                  if (ids.length === 0) return;
                  setDryOpen(false);
                  void applyBatch(ids);
                }}
              >
                {(() => {
                  const n = dryItems.filter((i) => i.action === "apply").length;
                  return n === 0 ? "Nada que aplicar" : `Aplicar ${n}`;
                })()}
              </ModalButton>
            </ModalFooter>
          </ModalPanel>
        </ModalOverlay>
      ) : null}

      {/* Progress modal */}
      {progress.visible ? (
        <ModalOverlay onClose={undefined}>
          <ModalPanel width={560}>
            <div style={{ padding: 20 }}>
              <h3
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginBottom: 14,
                }}
              >
                {progress.title || "Aplicando portadas…"}
              </h3>
              <div
                style={{
                  height: 6,
                  background: "var(--bg-hover)",
                  borderRadius: 3,
                  overflow: "hidden",
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${
                      progress.total > 0 ? (progress.current / progress.total) * 100 : 0
                    }%`,
                    background: "var(--accent)",
                    transition: "width 0.2s",
                  }}
                />
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 12 }}>
                {progress.label}
              </div>
              <div
                style={{
                  maxHeight: 220,
                  overflowY: "auto",
                  fontSize: 12,
                  fontFamily: "var(--font-geist-mono), monospace",
                  padding: 10,
                  background: "var(--bg)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                }}
              >
                {progress.log.map((entry, i) => (
                  <div
                    key={i}
                    style={{
                      color: entry.kind === "ok" ? "var(--success)" : "var(--error)",
                      lineHeight: 1.5,
                    }}
                  >
                    {entry.text}
                  </div>
                ))}
              </div>
              {progress.finished ? (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
                  <ModalButton
                    variant="primary"
                    onClick={() => setProgress((p) => ({ ...p, visible: false }))}
                  >
                    Cerrar
                  </ModalButton>
                </div>
              ) : null}
            </div>
          </ModalPanel>
        </ModalOverlay>
      ) : null}

      {/* Subtitles batch modal */}
      {subOpen ? (
        <ModalOverlay onClose={closeSubBatch}>
          <ModalPanel width={780}>
            <ModalHeader onClose={closeSubBatch}>Subir subtítulos en lote</ModalHeader>
            <div
              style={{
                padding: 20,
                maxHeight: "65vh",
                overflowY: "auto",
              }}
            >
              {subStep === "pick" ? (
                <div>
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--text-secondary)",
                      marginBottom: 16,
                    }}
                  >
                    Seleccioná uno o varios archivos SRT. El idioma se detecta por el sufijo del
                    nombre (<code>_es</code>, <code>_en</code>, <code>_pt</code>…). Sin sufijo →
                    Español por defecto.
                  </p>
                  <input
                    type="file"
                    accept=".srt,.vtt"
                    multiple
                    onChange={(e) => onSubFiles(e.target.files)}
                    style={{
                      width: "100%",
                      padding: 12,
                      border: "2px dashed var(--border)",
                      borderRadius: 6,
                      fontSize: 12.5,
                      cursor: "pointer",
                      background: "var(--bg)",
                      color: "var(--text-primary)",
                    }}
                  />
                </div>
              ) : subStep === "match" ? (
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 12,
                    }}
                  >
                    <p style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: 0 }}>
                      {(() => {
                        const matched = subRows.filter((r) => r.videoId).length;
                        return `${matched} de ${subRows.length} listos para subir.`;
                      })()}
                    </p>
                    <button
                      type="button"
                      onClick={openSubBatch}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--text-tertiary)",
                        cursor: "pointer",
                        fontSize: 12,
                        padding: "2px 6px",
                        borderRadius: 3,
                      }}
                    >
                      Limpiar lote
                    </button>
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ background: "var(--bg-hover)" }}>
                        <SubTh>Archivo</SubTh>
                        <SubTh>Video</SubTh>
                        <SubTh style={{ width: 140 }}>Idioma</SubTh>
                        <SubTh style={{ width: 36 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {subRows.map((row) => (
                        <tr
                          key={row.id}
                          style={{ borderBottom: "1px solid var(--border-subtle)" }}
                        >
                          <td style={{ padding: "8px 10px", verticalAlign: "middle" }}>
                            <span
                              style={{
                                color: row.videoId ? "var(--success)" : "var(--warning)",
                                fontWeight: 600,
                                marginRight: 6,
                              }}
                            >
                              {row.videoId ? "✓" : "?"}
                            </span>
                            <span
                              style={{
                                fontSize: 12,
                                fontFamily: "var(--font-geist-mono), monospace",
                                color: "var(--text-primary)",
                              }}
                            >
                              {row.file.name}
                            </span>
                          </td>
                          <td style={{ padding: "6px 10px", verticalAlign: "middle" }}>
                            <select
                              value={row.videoId}
                              onChange={(e) =>
                                updateSubRow(row.id, { videoId: e.target.value })
                              }
                              style={{
                                width: "100%",
                                padding: 5,
                                border: "1px solid var(--border)",
                                borderRadius: 4,
                                fontSize: 12,
                                background: "var(--bg)",
                                color: "var(--text-primary)",
                              }}
                            >
                              <option value="">— sin match —</option>
                              {videos.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.name.slice(0, 45)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: "6px 10px", verticalAlign: "middle" }}>
                            <select
                              value={row.language}
                              onChange={(e) =>
                                updateSubRow(row.id, { language: e.target.value })
                              }
                              style={{
                                width: "100%",
                                padding: 5,
                                border: "1px solid var(--border)",
                                borderRadius: 4,
                                fontSize: 12,
                                background: "var(--bg)",
                                color: "var(--text-primary)",
                              }}
                            >
                              {Object.entries(LANG_LABELS).map(([code, label]) => (
                                <option key={code} value={code}>
                                  {label} ({code})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td
                            style={{
                              padding: "6px 10px",
                              textAlign: "center",
                              verticalAlign: "middle",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => removeSubRow(row.id)}
                              title="Quitar"
                              style={{
                                background: "none",
                                border: "none",
                                color: "var(--text-tertiary)",
                                cursor: "pointer",
                                fontSize: 14,
                                padding: 2,
                              }}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div>
                  <div
                    style={{
                      height: 6,
                      background: "var(--bg-hover)",
                      borderRadius: 3,
                      overflow: "hidden",
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${
                          subProgress.total > 0
                            ? (subProgress.current / subProgress.total) * 100
                            : 0
                        }%`,
                        background: "var(--accent)",
                        transition: "width 0.2s",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: "var(--text-secondary)",
                      marginBottom: 12,
                    }}
                  >
                    {subProgress.label}
                  </div>
                  <div
                    style={{
                      maxHeight: 220,
                      overflowY: "auto",
                      fontSize: 11.5,
                      fontFamily: "var(--font-geist-mono), monospace",
                      padding: 10,
                      background: "var(--bg)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 6,
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                    }}
                  >
                    {subProgress.log.map((entry, i) => (
                      <div
                        key={i}
                        style={{
                          color: entry.kind === "ok" ? "var(--success)" : "var(--error)",
                        }}
                      >
                        {entry.text}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <ModalFooter>
              {subStep === "progress" ? (
                subProgress.finished ? (
                  <ModalButton variant="primary" onClick={closeSubBatch}>
                    Cerrar
                  </ModalButton>
                ) : null
              ) : (
                <>
                  <ModalButton onClick={closeSubBatch}>Cancelar</ModalButton>
                  <ModalButton
                    variant="primary"
                    disabled={
                      subStep !== "match" || subRows.filter((r) => r.videoId).length === 0
                    }
                    onClick={() => void runSubBatch()}
                  >
                    {(() => {
                      const matched = subRows.filter((r) => r.videoId).length;
                      return matched > 0 ? `Subir ${matched}` : "Subir";
                    })()}
                  </ModalButton>
                </>
              )}
            </ModalFooter>
          </ModalPanel>
        </ModalOverlay>
      ) : null}

      {/* Toasts */}
      <div
        style={{
          position: "fixed",
          top: 20,
          right: 20,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 100,
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              color: "var(--text-primary)",
              background: "var(--bg-card)",
              border: `1px solid ${
                t.kind === "success"
                  ? "var(--success)"
                  : t.kind === "error"
                    ? "var(--error)"
                    : "var(--border)"
              }`,
              boxShadow: "0 6px 20px rgba(0,0,0,.25)",
              maxWidth: 360,
            }}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────

interface TreeNodeProps {
  id: string;
  depth: number;
  foldersById: Record<string, Folder>;
  childrenOf: Record<string, string[]>;
  expanded: Record<string, boolean>;
  activeId: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}

function TreeNode({
  id,
  depth,
  foldersById,
  childrenOf,
  expanded,
  activeId,
  onToggle,
  onSelect,
}: TreeNodeProps) {
  const f = foldersById[id];
  if (!f) return null;
  const kids = childrenOf[id] ?? [];
  const hasKids = kids.length > 0;
  const isOpen = !!expanded[id];
  const isActive = activeId === id;

  return (
    <div>
      <div
        onClick={() => onSelect(id)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 8px",
          paddingLeft: 8 + depth * 12,
          cursor: "pointer",
          borderRadius: 5,
          fontSize: 12.5,
          background: isActive ? "var(--accent-subtle)" : "transparent",
          color: isActive ? "var(--accent)" : "var(--text-primary)",
          border: `1px solid ${isActive ? "var(--accent-border)" : "transparent"}`,
        }}
      >
        <span
          onClick={(e) => {
            e.stopPropagation();
            if (hasKids) onToggle(id);
          }}
          style={{
            width: 12,
            fontSize: 9,
            color: "var(--text-tertiary)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: hasKids ? "pointer" : "default",
          }}
        >
          {hasKids ? (isOpen ? "▼" : "▶") : ""}
        </span>
        <span
          style={{
            flex: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={f.name}
        >
          {f.name}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{f.video_count}</span>
      </div>
      {hasKids && isOpen ? (
        <div>
          {kids.map((cid) => (
            <TreeNode
              key={cid}
              id={cid}
              depth={depth + 1}
              foldersById={foldersById}
              childrenOf={childrenOf}
              expanded={expanded}
              activeId={activeId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FlatFolderNode({
  folder,
  active,
  onSelect,
}: {
  folder: Folder;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      onClick={() => onSelect(folder.id)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        cursor: "pointer",
        borderRadius: 5,
        fontSize: 12.5,
        background: active ? "var(--accent-subtle)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-primary)",
        border: `1px solid ${active ? "var(--accent-border)" : "transparent"}`,
      }}
    >
      <span
        style={{
          flex: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={folder.name}
      >
        {folder.name}
      </span>
      <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{folder.video_count}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 60,
        color: "var(--text-secondary)",
      }}
    >
      <div style={{ fontSize: 48, marginBottom: 20 }}>🎬</div>
      <h3 style={{ fontSize: 18, color: "var(--text-primary)", marginBottom: 8 }}>
        Seleccioná una carpeta para comenzar
      </h3>
      <p style={{ fontSize: 13.5, maxWidth: 460, lineHeight: 1.55, color: "var(--text-secondary)" }}>
        Navegá por las carpetas del panel izquierdo para ver y gestionar los videos.
      </p>
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 28,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <EmptyStep n={1} label="Seleccioná una carpeta" />
        <EmptyStep n={2} label="Elegí el timecode" />
        <EmptyStep n={3} label="Preview o aplicá todos" />
        <EmptyStep n={4} label="Subí subtítulos" />
      </div>
    </div>
  );
}

function EmptyStep({ n, label }: { n: number; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: "12px 16px",
        background: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 8,
        minWidth: 120,
      }}
    >
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "var(--accent-subtle)",
          border: "1px solid var(--accent-border)",
          color: "var(--accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {n}
      </span>
      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</span>
    </div>
  );
}

interface FolderContentProps {
  folder: Folder | null;
  videos: Video[];
  loading: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: (checked: boolean) => void;
  onOpenPreview: (id: string) => void;
  childrenIds: string[];
  foldersById: Record<string, Folder>;
  onFolderClick: (id: string) => void;
}

function FolderContent({
  folder,
  videos,
  loading,
  selected,
  onToggle,
  onSelectAll,
  onOpenPreview,
  childrenIds,
  foldersById,
  onFolderClick,
}: FolderContentProps) {
  const allSelected = videos.length > 0 && selected.size === videos.length;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
            {folder?.name ?? ""}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
            {loading
              ? "Cargando…"
              : `${videos.length} video${videos.length === 1 ? "" : "s"} · ID ${folder?.id ?? ""}`}
          </div>
        </div>
        {videos.length > 0 ? (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => onSelectAll(e.target.checked)}
            />
            Seleccionar todos
          </label>
        ) : null}
      </div>

      {loading ? null : videos.length === 0 ? (
        childrenIds.length > 0 ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 12,
            }}
          >
            {childrenIds.map((cid) => {
              const f = foldersById[cid];
              if (!f) return null;
              return (
                <div
                  key={cid}
                  onClick={() => onFolderClick(cid)}
                  style={{
                    padding: 14,
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 8,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: 20 }}>📁</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        color: "var(--text-primary)",
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {f.name}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>
                      {f.video_count} video{f.video_count === 1 ? "" : "s"}
                    </div>
                  </div>
                  <span style={{ color: "var(--text-tertiary)" }}>›</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
            Esta carpeta no tiene videos ni subcarpetas.
          </p>
        )
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 14,
          }}
        >
          {videos.map((v) => (
            <VideoCard
              key={v.id}
              video={v}
              selected={selected.has(v.id)}
              onToggle={onToggle}
              onOpenPreview={onOpenPreview}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VideoCard({
  video,
  selected,
  onToggle,
  onOpenPreview,
}: {
  video: Video;
  selected: boolean;
  onToggle: (id: string) => void;
  onOpenPreview: (id: string) => void;
}) {
  const status = video.transcode_status ?? "?";
  const statusColor =
    status === "complete"
      ? "var(--success)"
      : status === "error"
        ? "var(--error)"
        : "var(--text-tertiary)";
  const statusBg =
    status === "complete"
      ? "var(--success-subtle)"
      : status === "error"
        ? "rgba(230,69,69,.1)"
        : "var(--bg-hover)";

  return (
    <div
      onClick={() => onToggle(video.id)}
      onDoubleClick={() => onOpenPreview(video.id)}
      style={{
        background: "var(--bg-card)",
        border: `1px solid ${selected ? "var(--accent)" : "var(--border-subtle)"}`,
        borderRadius: 8,
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color .12s, transform .12s",
        outline: selected ? "1px solid var(--accent)" : "none",
      }}
    >
      <div
        style={{
          position: "relative",
          background: "var(--bg)",
          aspectRatio: "16/9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {video.thumb_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={video.thumb_url}
            alt=""
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span style={{ fontSize: 28, color: "var(--text-tertiary)" }}>🎬</span>
        )}
        <div
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            width: 18,
            height: 18,
            borderRadius: 4,
            border: `1.5px solid ${selected ? "var(--accent)" : "rgba(255,255,255,.85)"}`,
            background: selected ? "var(--accent)" : "rgba(0,0,0,.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {selected ? "✓" : ""}
        </div>
        <span
          style={{
            position: "absolute",
            bottom: 6,
            right: 6,
            padding: "2px 6px",
            fontSize: 11,
            fontFamily: "var(--font-geist-mono), monospace",
            background: "rgba(0,0,0,.7)",
            color: "#fff",
            borderRadius: 3,
          }}
        >
          {fmtDur(video.duration)}
        </span>
      </div>
      <div style={{ padding: "10px 12px" }}>
        <div
          title={video.name}
          style={{
            fontSize: 12.5,
            color: "var(--text-primary)",
            fontWeight: 500,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            minHeight: 34,
          }}
        >
          {video.name}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
          <span
            style={{
              padding: "2px 6px",
              borderRadius: 3,
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: 0.3,
              textTransform: "uppercase",
              color: statusColor,
              background: statusBg,
              border: `1px solid ${
                status === "complete"
                  ? "var(--success)"
                  : status === "error"
                    ? "var(--error)"
                    : "var(--border-subtle)"
              }`,
            }}
          >
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}

function TopButton({
  children,
  onClick,
  variant = "ghost",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "ghost" | "primary";
  disabled?: boolean;
}) {
  const isPrimary = variant === "primary";
  const style: CSSProperties = {
    padding: "7px 14px",
    fontSize: 12.5,
    fontWeight: 500,
    borderRadius: 6,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: isPrimary ? "var(--accent)" : "transparent",
    color: isPrimary ? "#fff" : "var(--text-primary)",
    border: `1px solid ${isPrimary ? "var(--accent)" : "var(--border)"}`,
    transition: "background .12s, border-color .12s",
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={style}>
      {children}
    </button>
  );
}

function BarButton({
  children,
  onClick,
  variant = "ghost",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "ghost" | "primary" | "danger";
}) {
  const style: CSSProperties = {
    padding: "6px 12px",
    fontSize: 12.5,
    fontWeight: 500,
    borderRadius: 6,
    cursor: "pointer",
    background:
      variant === "primary"
        ? "var(--accent)"
        : variant === "danger"
          ? "rgba(230,69,69,.12)"
          : "transparent",
    color:
      variant === "primary"
        ? "#fff"
        : variant === "danger"
          ? "var(--error)"
          : "var(--text-primary)",
    border: `1px solid ${
      variant === "primary"
        ? "var(--accent)"
        : variant === "danger"
          ? "var(--error)"
          : "var(--border)"
    }`,
  };
  return (
    <button type="button" onClick={onClick} style={style}>
      {children}
    </button>
  );
}

function ModalOverlay({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div
      onClick={(e) => {
        if (onClose && e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.6)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      {children}
    </div>
  );
}

function ModalPanel({ children, width = 640 }: { children: ReactNode; width?: number }) {
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        width,
        maxWidth: "96vw",
        maxHeight: "90vh",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,.4)",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

function ModalHeader({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 20px",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <h3
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "var(--text-primary)",
        }}
      >
        {children}
      </h3>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-secondary)",
            fontSize: 20,
            cursor: "pointer",
            padding: 4,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 20px",
        borderTop: "1px solid var(--border-subtle)",
        background: "var(--bg-subtle)",
      }}
    >
      {children}
    </div>
  );
}

function ModalButton({
  children,
  onClick,
  variant = "ghost",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "ghost" | "primary";
  disabled?: boolean;
}) {
  const isPrimary = variant === "primary";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "7px 14px",
        fontSize: 12.5,
        fontWeight: 500,
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        background: isPrimary ? "var(--accent)" : "transparent",
        color: isPrimary ? "#fff" : "var(--text-primary)",
        border: `1px solid ${isPrimary ? "var(--accent)" : "var(--border)"}`,
      }}
    >
      {children}
    </button>
  );
}

function ThumbPanel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        style={{
          fontSize: 11,
          color: "var(--text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {label}
      </label>
      <div
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 6,
          aspectRatio: "16/9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function SubTh({
  children,
  style,
}: {
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "8px 10px",
        fontWeight: 600,
        color: "var(--text-secondary)",
        borderBottom: "1px solid var(--border-subtle)",
        fontSize: 11.5,
        ...(style ?? {}),
      }}
    >
      {children}
    </th>
  );
}
