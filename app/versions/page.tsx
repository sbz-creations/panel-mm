"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import * as tus from "tus-js-client";

interface FolderDTO {
  id: string;
  name: string;
  parent_id: string | null;
  video_count: number;
}

interface VideoDTO {
  id: string;
  name: string;
  duration: number;
  thumb_url: string | null;
}

type UploadStatus = "pending" | "uploading" | "done" | "error";

interface LocalItem {
  id: string;
  file: File;
  uploadStatus: UploadStatus;
  progressBytes: number;
  progressPct: number;
  errorMessage: string | null;
}

type MatchResult =
  | { status: "matched"; videoId: string; videoName: string }
  | { status: "no-match" }
  | { status: "collision"; videoIds: string[] };

interface RowVM {
  item: LocalItem;
  match: MatchResult;
}

const CONCURRENCY = 3;

function stripExt(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return name;
  return name.slice(0, idx);
}

function normalize(name: string): string {
  return stripExt(name).trim().toLowerCase();
}

function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function VersionsPage() {
  const [folders, setFolders] = useState<FolderDTO[]>([]);
  const [foldersById, setFoldersById] = useState<Record<string, FolderDTO>>({});
  const [childrenOf, setChildrenOf] = useState<Record<string, string[]>>({});
  const [rootIds, setRootIds] = useState<string[]>([]);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoDTO[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosError, setVideosError] = useState<string | null>(null);

  const [items, setItems] = useState<LocalItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadsRef = useRef<Map<string, tus.Upload>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/thumb/folders");
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.detail || `HTTP ${res.status}`);
        if (cancelled) return;
        const list = (body.folders ?? []) as FolderDTO[];
        const byId: Record<string, FolderDTO> = {};
        const children: Record<string, string[]> = {};
        for (const f of list) {
          byId[f.id] = f;
          children[f.id] = [];
        }
        const roots: string[] = [];
        for (const f of list) {
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
        setFolders(list);
        setFoldersById(byId);
        setChildrenOf(children);
        setRootIds(roots);
        setFoldersLoaded(true);
      } catch (err) {
        if (cancelled) return;
        setFoldersError(err instanceof Error ? err.message : String(err));
        setFoldersLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectFolder = useCallback(
    async (folderId: string) => {
      if (folderId === currentFolderId) return;
      setCurrentFolderId(folderId);
      setVideos([]);
      setVideosError(null);
      setVideosLoading(true);
      try {
        const res = await fetch(`/api/thumb/folders/${folderId}/videos`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.detail || `HTTP ${res.status}`);
        setVideos((body.videos ?? []) as VideoDTO[]);
      } catch (err) {
        setVideosError(err instanceof Error ? err.message : String(err));
      } finally {
        setVideosLoading(false);
      }
    },
    [currentFolderId],
  );

  const toggleExpand = useCallback((folderId: string) => {
    setExpanded((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  }, []);

  const currentFolder = currentFolderId ? (foldersById[currentFolderId] ?? null) : null;

  const breadcrumbChain = useMemo(() => {
    const chain: FolderDTO[] = [];
    let id: string | null = currentFolderId;
    while (id && foldersById[id]) {
      chain.unshift(foldersById[id]);
      id = foldersById[id].parent_id;
    }
    return chain;
  }, [currentFolderId, foldersById]);

  const searchHits = useMemo(() => {
    if (!search.trim()) return null;
    const term = search.trim().toLowerCase();
    return folders
      .filter((f) => f.name.toLowerCase().includes(term))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      .slice(0, 300);
  }, [folders, search]);

  const videosByName = useMemo(() => {
    const m = new Map<string, VideoDTO[]>();
    for (const v of videos) {
      const key = normalize(v.name);
      const arr = m.get(key);
      if (arr) arr.push(v);
      else m.set(key, [v]);
    }
    return m;
  }, [videos]);

  const rows: RowVM[] = useMemo(() => {
    return items.map((it) => {
      const matches = videosByName.get(normalize(it.file.name)) ?? [];
      let match: MatchResult;
      if (matches.length === 0) match = { status: "no-match" };
      else if (matches.length === 1)
        match = { status: "matched", videoId: matches[0].id, videoName: matches[0].name };
      else match = { status: "collision", videoIds: matches.map((v) => v.id) };
      return { item: it, match };
    });
  }, [items, videosByName]);

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;
    setItems((prev) => {
      const existingKeys = new Set(
        prev.map((it) => `${it.file.name}::${it.file.size}::${it.file.lastModified}`),
      );
      const additions: LocalItem[] = [];
      for (const f of incoming) {
        const key = `${f.name}::${f.size}::${f.lastModified}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        additions.push({
          id: makeId(),
          file: f,
          uploadStatus: "pending",
          progressBytes: 0,
          progressPct: 0,
          errorMessage: null,
        });
      }
      return [...prev, ...additions];
    });
  }, []);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const removeItem = (id: string) => {
    const upload = uploadsRef.current.get(id);
    if (upload) {
      try {
        upload.abort();
      } catch {
        // best-effort abort
      }
      uploadsRef.current.delete(id);
    }
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const clearFinished = () => {
    setItems((prev) => prev.filter((it) => it.uploadStatus !== "done"));
  };

  const stats = useMemo(() => {
    let matched = 0;
    let noMatch = 0;
    let collision = 0;
    let done = 0;
    let uploading = 0;
    let error = 0;
    let uploadable = 0;
    for (const r of rows) {
      if (r.match.status === "matched") matched += 1;
      else if (r.match.status === "no-match") noMatch += 1;
      else collision += 1;
      if (r.item.uploadStatus === "done") done += 1;
      else if (r.item.uploadStatus === "uploading") uploading += 1;
      else if (r.item.uploadStatus === "error") error += 1;
      if (
        r.match.status === "matched" &&
        (r.item.uploadStatus === "pending" || r.item.uploadStatus === "error")
      ) {
        uploadable += 1;
      }
    }
    return { matched, noMatch, collision, done, uploading, error, uploadable };
  }, [rows]);

  const updateItem = useCallback((id: string, patch: Partial<LocalItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const uploadOne = useCallback(
    (item: LocalItem, videoId: string): Promise<void> => {
      return new Promise<void>((resolve) => {
        const initiate = async () => {
          try {
            const res = await fetch(`/api/vimeo/videos/${videoId}/versions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                file_name: item.file.name,
                file_size: item.file.size,
              }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.detail || `HTTP ${res.status}`);
            const uploadLink = body?.upload_link as string | undefined;
            if (!uploadLink) throw new Error("No upload_link returned from Vimeo");

            updateItem(item.id, {
              uploadStatus: "uploading",
              progressBytes: 0,
              progressPct: 0,
              errorMessage: null,
            });

            const upload = new tus.Upload(item.file, {
              uploadUrl: uploadLink,
              endpoint: uploadLink,
              retryDelays: [0, 2000, 5000, 10000, 20000],
              chunkSize: 128 * 1024 * 1024,
              metadata: {
                filename: item.file.name,
                filetype: item.file.type || "application/octet-stream",
              },
              onError: (err) => {
                uploadsRef.current.delete(item.id);
                updateItem(item.id, {
                  uploadStatus: "error",
                  errorMessage: err instanceof Error ? err.message : String(err),
                });
                resolve();
              },
              onProgress: (bytesUploaded, bytesTotal) => {
                const pct = bytesTotal > 0 ? (bytesUploaded / bytesTotal) * 100 : 0;
                updateItem(item.id, { progressBytes: bytesUploaded, progressPct: pct });
              },
              onSuccess: () => {
                uploadsRef.current.delete(item.id);
                updateItem(item.id, {
                  uploadStatus: "done",
                  progressBytes: item.file.size,
                  progressPct: 100,
                });
                resolve();
              },
            });
            uploadsRef.current.set(item.id, upload);
            upload.start();
          } catch (err) {
            updateItem(item.id, {
              uploadStatus: "error",
              errorMessage: err instanceof Error ? err.message : String(err),
            });
            resolve();
          }
        };
        void initiate();
      });
    },
    [updateItem],
  );

  const startAll = async () => {
    if (isRunning) return;
    const queue: Array<{ item: LocalItem; videoId: string }> = [];
    for (const r of rows) {
      if (
        r.match.status === "matched" &&
        (r.item.uploadStatus === "pending" || r.item.uploadStatus === "error")
      ) {
        queue.push({ item: r.item, videoId: r.match.videoId });
      }
    }
    if (queue.length === 0) return;

    setIsRunning(true);
    const queueIds = new Set(queue.map((q) => q.item.id));
    setItems((prev) =>
      prev.map((it) =>
        queueIds.has(it.id)
          ? {
              ...it,
              uploadStatus: "pending",
              progressBytes: 0,
              progressPct: 0,
              errorMessage: null,
            }
          : it,
      ),
    );

    let cursor = 0;
    const workerCount = Math.min(CONCURRENCY, queue.length);
    const worker = async () => {
      while (cursor < queue.length) {
        const idx = cursor;
        cursor += 1;
        const job = queue[idx];
        await uploadOne(job.item, job.videoId);
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    setIsRunning(false);
  };

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
            Bulk Versions
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
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 4px" }}>
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
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Top bar with breadcrumb */}
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
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: 6,
              minWidth: 0,
            }}
          >
            {breadcrumbChain.length === 0 ? (
              <span style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
                ← Seleccioná una carpeta
              </span>
            ) : (
              breadcrumbChain.map((f, i) => (
                <span
                  key={f.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 0,
                  }}
                >
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
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {stats.done > 0 && !isRunning ? (
              <button type="button" onClick={clearFinished} style={secondaryBtnStyle}>
                Limpiar listos
              </button>
            ) : null}
            <button
              type="button"
              onClick={startAll}
              disabled={isRunning || stats.uploadable === 0}
              style={{
                ...primaryBtnStyle,
                opacity: isRunning || stats.uploadable === 0 ? 0.6 : 1,
                cursor:
                  isRunning || stats.uploadable === 0 ? "not-allowed" : "pointer",
              }}
            >
              {isRunning
                ? `Subiendo… (${stats.uploading}/${CONCURRENCY})`
                : `Subir ${stats.uploadable} versione${stats.uploadable === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, overflow: "auto", padding: "24px 20px" }}>
          {!currentFolderId ? (
            <EmptyState />
          ) : (
            <div style={{ maxWidth: 1080, margin: "0 auto" }}>
              {/* Folder header */}
              <div style={{ marginBottom: 16 }}>
                <h2
                  style={{
                    fontSize: 20,
                    fontWeight: 600,
                    letterSpacing: -0.3,
                    marginBottom: 4,
                    color: "var(--text-primary)",
                  }}
                >
                  {currentFolder?.name ?? "…"}
                </h2>
                <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
                  {videosLoading
                    ? "Cargando videos…"
                    : videosError
                      ? `Error: ${videosError}`
                      : `${videos.length} video${videos.length === 1 ? "" : "s"} disponibles para reversionar`}
                </div>
              </div>

              {/* Dropzone */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${
                    isDragging ? "var(--accent)" : "var(--border-subtle)"
                  }`,
                  background: isDragging
                    ? "var(--accent-subtle)"
                    : "var(--bg-card)",
                  borderRadius: 10,
                  padding: "28px 20px",
                  textAlign: "center",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    fontSize: 13.5,
                    color: "var(--text-primary)",
                    marginBottom: 4,
                  }}
                >
                  Arrastrá archivos acá o hacé click para elegirlos
                </div>
                <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                  El nombre del archivo (sin extensión) debe coincidir con el título del
                  video en Vimeo.
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                  disabled={isRunning}
                />
              </div>

              {rows.length > 0 ? (
                <div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                    <Chip label={`${stats.matched} matched`} tone="ok" />
                    {stats.noMatch > 0 ? (
                      <Chip label={`${stats.noMatch} sin match`} tone="warn" />
                    ) : null}
                    {stats.collision > 0 ? (
                      <Chip label={`${stats.collision} colisión`} tone="warn" />
                    ) : null}
                    {stats.uploading > 0 ? (
                      <Chip label={`${stats.uploading} subiendo`} tone="info" />
                    ) : null}
                    {stats.done > 0 ? (
                      <Chip label={`${stats.done} listos`} tone="ok" />
                    ) : null}
                    {stats.error > 0 ? (
                      <Chip label={`${stats.error} error`} tone="err" />
                    ) : null}
                  </div>
                  <div
                    style={{
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 8,
                      overflow: "hidden",
                      background: "var(--bg-card)",
                    }}
                  >
                    {rows.map((r, idx) => (
                      <FileRow
                        key={r.item.id}
                        row={r}
                        isLast={idx === rows.length - 1}
                        onRemove={() => removeItem(r.item.id)}
                        disabled={isRunning}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const primaryBtnStyle: React.CSSProperties = {
  padding: "7px 14px",
  fontSize: 12.5,
  fontWeight: 600,
  border: "1px solid var(--accent-border)",
  background: "var(--accent)",
  color: "white",
  borderRadius: 6,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "7px 12px",
  fontSize: 12.5,
  fontWeight: 500,
  border: "1px solid var(--border)",
  background: "var(--bg-card)",
  color: "var(--text-secondary)",
  borderRadius: 6,
  cursor: "pointer",
};

interface TreeNodeProps {
  id: string;
  depth: number;
  foldersById: Record<string, FolderDTO>;
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
        <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
          {f.video_count}
        </span>
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
  folder: FolderDTO;
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
      <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
        {folder.video_count}
      </span>
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
      <div style={{ fontSize: 48, marginBottom: 20 }}>🔁</div>
      <h3
        style={{
          fontSize: 18,
          color: "var(--text-primary)",
          marginBottom: 8,
        }}
      >
        Seleccioná una carpeta para comenzar
      </h3>
      <p
        style={{
          fontSize: 13.5,
          maxWidth: 460,
          lineHeight: 1.55,
          color: "var(--text-secondary)",
        }}
      >
        Elegí la carpeta que contiene los videos que querés reversionar. Después arrastrá
        los archivos nuevos — el matching es por nombre de archivo = título del video.
      </p>
    </div>
  );
}

function Chip({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "warn" | "err" | "info";
}) {
  const palette: Record<typeof tone, { bg: string; border: string; color: string }> = {
    ok: {
      bg: "var(--accent-subtle)",
      border: "var(--accent-border)",
      color: "var(--accent)",
    },
    warn: {
      bg: "var(--warning-subtle)",
      border: "var(--warning-border)",
      color: "var(--warning)",
    },
    err: { bg: "#fdecea", border: "#f5c2c0", color: "#c0392b" },
    info: {
      bg: "var(--bg-hover)",
      border: "var(--border)",
      color: "var(--text-secondary)",
    },
  };
  const p = palette[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 9px",
        borderRadius: 999,
        background: p.bg,
        border: `1px solid ${p.border}`,
        color: p.color,
        fontSize: 11.5,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

function FileRow({
  row,
  isLast,
  onRemove,
  disabled,
}: {
  row: RowVM;
  isLast: boolean;
  onRemove: () => void;
  disabled: boolean;
}) {
  const { item, match } = row;

  const status = (() => {
    if (item.uploadStatus === "done") return { label: "Listo", tone: "ok" as const };
    if (item.uploadStatus === "uploading") {
      return {
        label: `Subiendo ${item.progressPct.toFixed(0)}%`,
        tone: "info" as const,
      };
    }
    if (item.uploadStatus === "error") return { label: "Error", tone: "err" as const };
    if (match.status === "matched")
      return { label: "Listo para subir", tone: "ok" as const };
    if (match.status === "no-match")
      return { label: "Sin match", tone: "warn" as const };
    return { label: "Colisión", tone: "warn" as const };
  })();

  const detail = (() => {
    if (item.uploadStatus === "error")
      return item.errorMessage ?? "Falló la subida";
    if (match.status === "no-match")
      return "Ningún video de la carpeta coincide con este nombre.";
    if (match.status === "collision")
      return `Matchea ${match.videoIds.length} videos: ${match.videoIds.join(", ")} — resolvé manualmente en Vimeo.`;
    return `→ ${match.videoName} (ID ${match.videoId})`;
  })();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        gap: 14,
        alignItems: "center",
        padding: "12px 14px",
        borderBottom: isLast ? "none" : "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={item.file.name}
        >
          {item.file.name}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color:
              match.status === "matched" || item.uploadStatus === "done"
                ? "var(--text-tertiary)"
                : item.uploadStatus === "error"
                  ? "#c0392b"
                  : "var(--warning, #a86c00)",
            marginTop: 3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={detail}
        >
          {detail}
        </div>
        {item.uploadStatus === "uploading" ? (
          <div
            style={{
              marginTop: 6,
              height: 4,
              width: "100%",
              background: "var(--bg-hover)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${item.progressPct}%`,
                background: "var(--accent)",
                transition: "width 0.15s",
              }}
            />
          </div>
        ) : null}
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: "var(--text-tertiary)",
          whiteSpace: "nowrap",
        }}
      >
        {humanSize(item.file.size)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Chip label={status.label} tone={status.tone} />
        {item.uploadStatus !== "uploading" ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            aria-label="Quitar"
            style={{
              width: 22,
              height: 22,
              padding: 0,
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-card)",
              borderRadius: 5,
              cursor: disabled ? "not-allowed" : "pointer",
              color: "var(--text-tertiary)",
              fontSize: 13,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}
