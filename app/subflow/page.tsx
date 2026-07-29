"use client";
import React, { useState, useRef, useCallback, useEffect, createContext, useContext } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { transcribeFile, transcribeFromUrl, translateSrt, getConfig, saveConfig, saveFile, analyzeInserts, InsertSuggestion, getHistory, saveJob, HistoryJob, prependTitleBlock } from "@/lib/api";
import { Locale, translations } from "@/lib/i18n";

const languages = ["EN", "PT", "FR", "DE", "IT", "JP"];

function formatSrtLines(srt: string, lines: 1 | 2): string {
  const MAX = 42;
  return srt.replace(/(^|\n)(\d+\n[\d:,]+ --> [\d:,]+\n)([\s\S]*?)(?=\n\n|\n*$)/gm,
    (match, pre, header, text) => {
      const flat = text.trim().replace(/\n/g, " ");
      if (lines === 1 || flat.length <= MAX) return pre + header + flat;
      const mid = Math.floor(flat.length / 2);
      let splitAt = mid;
      for (let i = 0; i <= mid; i++) {
        if (flat[mid + i] === " ") { splitAt = mid + i; break; }
        if (mid - i >= 0 && flat[mid - i] === " ") { splitAt = mid - i; break; }
      }
      const l1 = flat.slice(0, splitAt).trim();
      const l2 = flat.slice(splitAt).trim();
      return pre + header + (l2 ? l1 + "\n" + l2 : flat);
    }
  );
}

function applyTimingOffset(srt: string, offsetSeconds: number): string {
  if (offsetSeconds === 0) return srt;
  const toMs = (ts: string) => {
    const [h, m, rest] = ts.split(":");
    const [s, ms] = rest.split(",");
    return ((+h * 3600 + +m * 60 + +s) * 1000) + +ms;
  };
  const toTs = (ms: number) => {
    const clamped = Math.max(0, ms);
    const h = Math.floor(clamped / 3600000);
    const m = Math.floor((clamped % 3600000) / 60000);
    const s = Math.floor((clamped % 60000) / 1000);
    const ms2 = clamped % 1000;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms2).padStart(3, "0")}`;
  };
  const offsetMs = Math.round(offsetSeconds * 1000);
  return srt.replace(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/g, (_, start, end) =>
    `${toTs(toMs(start) + offsetMs)} --> ${toTs(toMs(end) + offsetMs)}`
  );
}

type FileStatus = "waiting" | "processing" | "done" | "error";
type TranslationModel = "google" | "haiku" | "sonnet";
type View = "panel" | "historial" | "configuracion" | "editor";

interface FileEntry {
  file?: File;      // present for file uploads
  url?: string;     // present for URL inputs
  name: string;     // key: file.name or URL-derived label
  status: FileStatus;
  statusLabel: string;
  title: string;
}

const mockJobs = [
  { file: "clase-01-pressing.srt", langs: "EN · PT · FR", model: "Google", date: "Jul 7, 2026", status: "done" },
  { file: "clase-02-construccion.mp4", langs: "EN · PT", model: "Whisper", date: "Jul 7, 2026", status: "processing" },
  { file: "clase-03-defensiva.srt", langs: "EN · PT · FR · DE", model: "Google", date: "Jul 6, 2026", status: "done" },
  { file: "intro-temporada-2026.mp4", langs: "EN · PT · FR · DE · IT", model: "Claude", date: "Jul 5, 2026", status: "done" },
  { file: "clase-04-presion-alta.srt", langs: "EN · PT", model: "Google", date: "Jul 4, 2026", status: "done" },
  { file: "clase-05-contraataque.srt", langs: "EN · PT · FR · DE · IT", model: "Google", date: "Jul 3, 2026", status: "done" },
];

const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({
  locale: "es",
  setLocale: () => {},
});

const useT = () => translations[useContext(LocaleContext).locale];

export default function Home() {
  const [locale, setLocale] = useState<Locale>("es");
  const [view, setView] = useState<View>("panel");
  const [selectedLangs, setSelectedLangs] = useState(["EN", "PT", "FR", "DE", "IT"]);
  const [selectedModel, setSelectedModel] = useState<TranslationModel>("google");
  const [lineMode, setLineMode] = useState<1 | 2>(2);
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ status: "", percent: 0 });
  const [results, setResults] = useState<Record<string, Record<string, string>>>({});
  const [transcriptions, setTranscriptions] = useState<Record<string, string>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [outputFolder, setOutputFolder] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [cookiesFile, setCookiesFile] = useState("");
  const [detectedLanguages, setDetectedLanguages] = useState<Record<string, string>>({});
  const [inserts, setInserts] = useState<InsertSuggestion[]>([]);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editingSrt, setEditingSrt] = useState<string>("");
  const [editedFiles, setEditedFiles] = useState<Set<string>>(new Set());
  const [historyTotal, setHistoryTotal] = useState(0);
  const [timeOffset, setTimeOffset] = useState(0);
  const [titleDuration, setTitleDuration] = useState(4);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getConfig().then((c) => {
      setOutputFolder(c.output_folder);
      setAnthropicKey(c.anthropic_api_key);
      setCookiesFile(c.cookies_file);
    });
    getHistory().then(jobs => setHistoryTotal(jobs.length));
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const hasVideoFiles = fileEntries.some(e => e.url || /\.(mp4|mov|mkv|avi)$/i.test(e.name));
  const pendingCount = fileEntries.filter(e => e.status === "waiting" || e.status === "error").length;

  const handleNewJob = () => {
    setFileEntries([]);
    setResults({});
    setTranscriptions({});
    setInserts([]);
    setProgress({ status: "", percent: 0 });
    setTimeOffset(0);
  };

  const toggleLang = (lang: string) => {
    setSelectedLangs(prev =>
      prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang]
    );
  };

  const removeEntry = (name: string) => {
    setFileEntries(prev => prev.filter(e => e.name !== name));
    setResults(prev => { const n = { ...prev }; delete n[name]; return n; });
  };

  const addFiles = useCallback((incoming: File[]) => {
    const accepted = incoming.filter(f => /\.(srt|mp4|mov|mkv|avi)$/i.test(f.name));
    if (!accepted.length) return;
    setFileEntries(prev => {
      const existingNames = new Set(prev.map(e => e.name));
      const t = translations[locale];
      const fresh = accepted
        .filter(f => !existingNames.has(f.name))
        .map(f => ({
          file: f,
          name: f.name,
          status: "waiting" as FileStatus,
          statusLabel: t.status.queued,
          title: f.name.replace(/\.[^.]+$/, "").replace(/^\d+[\s\-_.]+/, "").trim(),
        }));
      return [...prev, ...fresh];
    });
  }, [locale]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, [addFiles]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
    e.target.value = "";
  };

  const updateEntry = (name: string, patch: Partial<FileEntry>) => {
    setFileEntries(prev => prev.map(e => e.name === name ? { ...e, ...patch } : e));
  };

  const updateTitle = (filename: string, title: string) => {
    setFileEntries(prev => prev.map(e => e.name === filename ? { ...e, title } : e));
  };

  const addUrl = useCallback((url: string) => {
    const label = url.replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 50);
    const t = translations[locale];
    setFileEntries(prev => {
      if (prev.some(e => e.url === url)) return prev;
      return [...prev, {
        url,
        name: label,
        status: "waiting" as FileStatus,
        statusLabel: t.status.queued,
        title: label,
      }];
    });
  }, [locale]);

  const handleProcess = async () => {
    if (!fileEntries.length || processing) return;
    const pending = fileEntries.filter(e => e.status === "waiting" || e.status === "error");
    if (!pending.length) return;
    setProcessing(true);
    const t = translations[locale];
    setProgress({ status: t.status.initiating, percent: 0 });

    for (const entry of pending) {
      const isSrt = !entry.url && /\.srt$/i.test(entry.name);
      updateEntry(entry.name, { status: "processing", statusLabel: t.status.processing });

      try {
        let srt: string;

        const onLangDetected = (lang: string) => {
          setDetectedLanguages(prev => ({ ...prev, [entry.name]: lang.toUpperCase() }));
        };

        if (entry.url) {
          srt = await transcribeFromUrl(entry.url, "auto", (update) => {
            const labels: Record<string, string> = {
              downloading: t.status.downloading,
              loading_model: t.status.loadingModel,
              transcribing: t.status.transcribing,
              done: t.status.transcriptionDone,
            };
            setProgress({
              status: `${labels[update.status] ?? update.status} · ${entry.name}`,
              percent: update.percent,
            });
            updateEntry(entry.name, { statusLabel: labels[update.status] ?? update.status });
          }, onLangDetected);
        } else if (isSrt) {
          srt = await entry.file!.text();
          setProgress({ status: `${t.status.reading} ${entry.name}`, percent: 60 });
        } else {
          srt = await transcribeFile(entry.file!, "large-v3", "auto", (update) => {
            const labels: Record<string, string> = {
              loading_model: t.status.loadingModel,
              transcribing: t.status.transcribing,
              done: t.status.transcriptionDone,
            };
            setProgress({
              status: `${labels[update.status] ?? update.status} · ${entry.name}`,
              percent: update.percent,
            });
            updateEntry(entry.name, { statusLabel: labels[update.status] ?? update.status });
          }, onLangDetected);
        }

        srt = formatSrtLines(srt, lineMode);
        if (timeOffset !== 0) srt = applyTimingOffset(srt, timeOffset);
        setTranscriptions(prev => ({ ...prev, [entry.name]: srt }));
        if (anthropicKey) {
          analyzeInserts(srt).then(found => {
            if (found.length) setInserts(prev => [...prev.filter(i => !found.some(f => f.timecode === i.timecode)), ...found]);
          });
        }

        // Video / URL entries: stop after transcription, offer original SRT download only
        if (!isSrt) {
          const baseName = entry.name.replace(/[^a-z0-9]/gi, "_");
          setResults(prev => ({ ...prev, [entry.name]: { original: srt } }));
          if (outputFolder) {
            try { await saveFile(`${baseName}_original.srt`, srt); } catch { /* silent */ }
            updateEntry(entry.name, { status: "done", statusLabel: t.status.saved });
          } else {
            updateEntry(entry.name, { status: "done", statusLabel: t.status.done });
          }
          setProgress({ status: `${t.status.transcriptionDone} · ${entry.name}`, percent: 100 });
          saveJob({ filename: entry.name, type: "video", languages: ["original"], model: "Whisper", status: "done" }).catch(() => {});
          continue;
        }

        if (!selectedLangs.length) {
          updateEntry(entry.name, { status: "done", statusLabel: t.status.done });
          saveJob({ filename: entry.name, type: "srt", languages: [], model: selectedModel === "google" ? "Google" : selectedModel === "haiku" ? "Claude Haiku" : "Claude Sonnet", status: "done" }).catch(() => {});
          continue;
        }

        setProgress({ status: `${t.status.translating} · ${entry.name}`, percent: 90 });
        updateEntry(entry.name, { statusLabel: t.status.translating });

        const detectedLang = detectedLanguages[entry.name];
        const effectiveLangs = selectedLangs
          .filter(l => l !== "ES")
          .filter(l => !detectedLang || l.toUpperCase() !== detectedLang.toUpperCase());
        const translationResults = await translateSrt(srt, effectiveLangs, entry.title, titleDuration);
        setResults(prev => ({ ...prev, [entry.name]: translationResults }));

        if (outputFolder) {
          const baseName = entry.name.replace(/\.[^.]+$/, "");
          if (selectedLangs.includes("ES")) {
            const esContent = entry.title ? prependTitleBlock(srt, entry.title, titleDuration) : srt;
            try { await saveFile(`${baseName}_es.srt`, esContent); } catch { /* silent */ }
          }
          for (const [lang, content] of Object.entries(translationResults)) {
            try {
              await saveFile(`${baseName}_${lang}.srt`, content);
            } catch { /* silent */ }
          }
          setProgress({ status: `${t.status.savedTo} ${outputFolder}`, percent: 100 });
          updateEntry(entry.name, { status: "done", statusLabel: t.status.saved });
        } else {
          setProgress({ status: `${t.status.done} · ${entry.name}`, percent: 100 });
          updateEntry(entry.name, { status: "done", statusLabel: t.status.done });
        }
        saveJob({ filename: entry.name, type: "srt", languages: selectedLangs.map(l => l.toLowerCase()), model: selectedModel === "google" ? "Google" : selectedModel === "haiku" ? "Claude Haiku" : "Claude Sonnet", status: "done" }).catch(() => {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : t.status.error;
        updateEntry(entry.name, { status: "error", statusLabel: `${t.status.error}: ${msg}` });
        const isSrtFile = !entry.url && /\.srt$/i.test(entry.name);
        saveJob({ filename: entry.name, type: isSrtFile ? "srt" : "video", languages: isSrtFile ? selectedLangs.map(l => l.toLowerCase()) : ["original"], model: isSrtFile ? (selectedModel === "google" ? "Google" : selectedModel === "haiku" ? "Claude Haiku" : "Claude Sonnet") : "Whisper", status: "error" }).catch(() => {});
      }
    }

    setProcessing(false);
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      new Notification("Subflow", { body: "Processing complete.", icon: "/favicon.ico" });
    }
  };

  const openEditor = (name: string) => {
    const srt = transcriptions[name] ?? results[name]?.original ?? Object.values(results[name] ?? {})[0] ?? "";
    setEditingFile(name);
    setEditingSrt(srt);
    setView("editor");
  };

  const saveEdits = (newSrt: string) => {
    if (!editingFile) return;
    setTranscriptions(prev => ({ ...prev, [editingFile]: newSrt }));
    setResults(prev => {
      const fileResults = prev[editingFile] ?? {};
      const key = "original" in fileResults ? "original" : Object.keys(fileResults)[0];
      if (!key) return prev;
      return { ...prev, [editingFile]: { ...fileResults, [key]: newSrt } };
    });
    setEditedFiles(prev => new Set(prev).add(editingFile));
    setView("panel");
    setEditingFile(null);
  };

  const downloadZip = async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    for (const [filename, langs] of Object.entries(results)) {
      const base = filename.replace(/\.[^.]+$/, "");
      for (const [lang, content] of Object.entries(langs)) {
        const isOriginal = lang === "original";
        zip.file(`${base}_${isOriginal ? "original" : lang.toUpperCase()}.srt`, content);
      }
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "subtitles.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadResult = (filename: string, lang: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename.replace(/\.[^.]+$/, "")}_${lang.toLowerCase()}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <Nav view={view} setView={setView} />
        <main style={{ flex: 1, overflowY: "auto", background: "var(--bg-subtle)" }}>
          {view === "panel" && (
            <PanelView
              fileEntries={fileEntries}
              progress={progress}
              processing={processing}
              results={results}
              transcriptions={transcriptions}
              inserts={inserts}
              hasApiKey={!!anthropicKey}
              isDragging={isDragging}
              inputRef={inputRef}
              selectedLangs={selectedLangs}
              selectedModel={selectedModel}
              pendingCount={pendingCount}
              hasVideoFiles={hasVideoFiles}
              hasResults={Object.keys(results).length > 0}
              outputFolder={outputFolder}
              historyTotal={historyTotal}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onPickFiles={() => inputRef.current?.click()}
              onDownload={downloadResult}
              onDownloadZip={downloadZip}
              onUpdateTitle={updateTitle}
              onAddUrl={addUrl}
              onRemoveEntry={removeEntry}
              toggleLang={toggleLang}
              setSelectedModel={setSelectedModel}
              onProcess={handleProcess}
              onNewJob={handleNewJob}
              onOutputFolderChange={setOutputFolder}
              onGoToConfig={() => setView("configuracion")}
              lineMode={lineMode}
              setLineMode={setLineMode}
              onOpenEditor={openEditor}
              editedFiles={editedFiles}
              detectedLanguages={detectedLanguages}
              timeOffset={timeOffset}
              setTimeOffset={setTimeOffset}
              titleDuration={titleDuration}
              setTitleDuration={setTitleDuration}
            />
          )}
          {view === "historial" && <HistorialView />}
          {view === "editor" && editingFile && (
            <EditorView
              filename={editingFile}
              srt={editingSrt}
              onSave={saveEdits}
              onCancel={() => { setView("panel"); setEditingFile(null); }}
            />
          )}
          {view === "configuracion" && (
            <ConfiguracionView
              outputFolder={outputFolder}
              onOutputFolderChange={setOutputFolder}
              anthropicKey={anthropicKey}
              onAnthropicKeyChange={setAnthropicKey}
              cookiesFile={cookiesFile}
              onCookiesFileChange={setCookiesFile}
            />
          )}
        </main>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".srt,.mp4,.mov,.mkv,.avi"
          style={{ display: "none" }}
          onChange={handleInputChange}
        />
      </div>
    </LocaleContext.Provider>
  );
}

function Nav({ view, setView }: { view: View; setView: (v: View) => void }) {
  const t = useT();
  const { locale, setLocale } = useContext(LocaleContext);

  const navItems: { key: View; label: string }[] = [
    { key: "panel", label: t.nav.panel },
    { key: "historial", label: t.nav.historial },
    { key: "configuracion", label: t.nav.configuracion },
  ];

  return (
    <nav style={{
      height: 56,
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      padding: "0 24px",
      background: "var(--bg)",
      position: "sticky",
      top: 0,
      zIndex: 100,
    }}>
      <button
        onClick={() => setView("panel")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontWeight: 600,
          fontSize: 15,
          letterSpacing: "-0.3px",
          color: "var(--text-primary)",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          marginRight: 32,
          padding: 0,
        }}
      >
        <div style={{
          width: 24, height: 24,
          background: "var(--accent)",
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <svg viewBox="0 0 14 14" fill="none" width="14" height="14">
            <path d="M2 4h10M2 7h7M2 10h5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        Subflow
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 2, flex: 1 }}>
        {navItems.map(item => (
          <button
            key={item.key}
            onClick={() => setView(item.key)}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              color: view === item.key ? "var(--text-primary)" : "var(--text-secondary)",
              fontSize: 13.5,
              fontWeight: 400,
              cursor: "pointer",
              border: "none",
              background: view === item.key ? "var(--bg-card)" : "none",
              fontFamily: "inherit",
              transition: "all 0.15s",
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
        <div style={{ display: "flex", gap: 2 }}>
          {(["es", "en"] as Locale[]).map(l => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              style={{
                height: 26,
                padding: "0 9px",
                borderRadius: 6,
                border: locale === l ? "1px solid var(--accent-border)" : "1px solid var(--border)",
                background: locale === l ? "var(--accent-subtle)" : "none",
                color: locale === l ? "var(--accent)" : "var(--text-tertiary)",
                cursor: "pointer",
                fontSize: 11.5,
                fontWeight: 600,
                fontFamily: "var(--font-geist-mono), monospace",
                letterSpacing: "0.04em",
                transition: "all 0.15s",
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <ThemeToggle />
        <div style={{
          width: 28, height: 28,
          borderRadius: "50%",
          background: "linear-gradient(135deg, var(--accent), var(--cyan))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 600,
          color: "white",
          cursor: "pointer",
        }}>
          SG
        </div>
      </div>
    </nav>
  );
}

function PageShell({ title, subtitle, children }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 40px" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", color: "var(--text-primary)", marginBottom: 4 }}>
          {title}
        </div>
        {subtitle && <div style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

interface PanelViewProps {
  fileEntries: FileEntry[];
  progress: { status: string; percent: number };
  processing: boolean;
  results: Record<string, Record<string, string>>;
  transcriptions: Record<string, string>;
  inserts: InsertSuggestion[];
  hasApiKey: boolean;
  isDragging: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  selectedLangs: string[];
  selectedModel: TranslationModel;
  pendingCount: number;
  hasVideoFiles: boolean;
  hasResults: boolean;
  outputFolder: string;
  historyTotal: number;
  onOutputFolderChange: (folder: string) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onPickFiles: () => void;
  onDownload: (filename: string, lang: string, content: string) => void;
  onDownloadZip: () => void;
  onUpdateTitle: (filename: string, title: string) => void;
  onAddUrl: (url: string) => void;
  onRemoveEntry: (name: string) => void;
  toggleLang: (lang: string) => void;
  setSelectedModel: (m: TranslationModel) => void;
  onProcess: () => void;
  onNewJob: () => void;
  onGoToConfig: () => void;
  lineMode: 1 | 2;
  setLineMode: (m: 1 | 2) => void;
  onOpenEditor: (name: string) => void;
  editedFiles: Set<string>;
  detectedLanguages: Record<string, string>;
  timeOffset: number;
  setTimeOffset: React.Dispatch<React.SetStateAction<number>>;
  titleDuration: number;
  setTitleDuration: React.Dispatch<React.SetStateAction<number>>;
}

function PanelView(props: PanelViewProps) {
  const t = useT();
  const doneFiles = Object.keys(props.results).length;
  const totalChars = Object.values(props.results)
    .flatMap(r => Object.values(r))
    .reduce((sum, s) => sum + s.length, 0);
  const deeplCost = totalChars * 25 / 1_000_000;
  const formattedChars = totalChars > 0 ? totalChars.toLocaleString("es-AR") : "0";
  const formattedCost = totalChars === 0 ? "—" : deeplCost < 0.01 ? "< $0.01" : `$${deeplCost.toFixed(2)}`;

  const completedLabel = doneFiles !== 1 ? t.panel.statsDeltaCompleted_other : t.panel.statsDeltaCompleted_one;
  const { historyTotal } = props;

  const stats = [
    {
      label: t.panel.statsFiles,
      value: historyTotal > 0 ? String(historyTotal) : (doneFiles > 0 ? String(doneFiles) : "0"),
      delta: historyTotal > 0 ? `${historyTotal} total` : (doneFiles > 0 ? `${doneFiles} ${completedLabel}` : t.panel.statsDeltaNoFiles),
    },
    {
      label: t.panel.statsChars,
      value: formattedChars,
      delta: doneFiles > 0 ? `${t.panel.statsDeltaCharsIn} ${doneFiles} archivo${doneFiles !== 1 ? "s" : ""}` : t.panel.statsDeltaCharsProcess,
      accent: totalChars > 0,
    },
    {
      label: t.panel.statsHours,
      value: historyTotal > 0 ? (historyTotal * 0.5).toFixed(1) : "0",
      delta: t.panel.statsDeltaHours,
    },
    {
      label: t.panel.statsSavings,
      value: formattedCost,
      delta: totalChars > 0 ? `${formattedChars} chars · $25/M` : "$25 por millón de chars",
      accent: totalChars > 0,
    },
  ];

  return (
    <PageShell title={t.panel.title} subtitle={t.panel.subtitle}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 28 }}>
        {stats.map(s => (
          <div key={s.label} style={{
            background: "var(--bg)",
            border: `1px solid ${s.accent ? "var(--accent-border)" : "var(--border)"}`,
            borderRadius: 10,
            padding: "16px 18px",
          }}>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.5px", color: s.accent ? "var(--accent)" : "var(--text-primary)", fontFamily: "var(--font-geist-mono), monospace" }}>
              {s.value}
            </div>
            <div style={{ fontSize: 11.5, color: s.accent ? "var(--accent)" : "var(--success)", marginTop: 4, opacity: s.accent ? 0.7 : 1 }}>{s.delta}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <WorkflowCard
            fileEntries={props.fileEntries}
            progress={props.progress}
            processing={props.processing}
            results={props.results}
            detectedLanguages={props.detectedLanguages}
            isDragging={props.isDragging}
            hasResults={props.hasResults}
            onDrop={props.onDrop}
            onDragOver={props.onDragOver}
            onDragLeave={props.onDragLeave}
            onPickFiles={props.onPickFiles}
            onDownload={props.onDownload}
            onDownloadZip={props.onDownloadZip}
            onUpdateTitle={props.onUpdateTitle}
            onAddUrl={props.onAddUrl}
            onRemoveEntry={props.onRemoveEntry}
            onOpenEditor={props.onOpenEditor}
            editedFiles={props.editedFiles}
          />
          <InsertsCard inserts={props.inserts} hasTranscription={Object.keys(props.transcriptions).length > 0} hasApiKey={props.hasApiKey} />
          <RecentJobsCard />
        </div>
        <RightPanel
          selectedLangs={props.selectedLangs}
          toggleLang={props.toggleLang}
          selectedModel={props.selectedModel}
          setSelectedModel={props.setSelectedModel}
          pendingCount={props.pendingCount}
          processing={props.processing}
          onProcess={props.onProcess}
          hasVideoFiles={props.hasVideoFiles}
          onNewJob={props.onNewJob}
          hasResults={props.hasResults}
          outputFolder={props.outputFolder}
          onOutputFolderChange={props.onOutputFolderChange}
          onGoToConfig={props.onGoToConfig}
          lineMode={props.lineMode}
          setLineMode={props.setLineMode}
          timeOffset={props.timeOffset}
          setTimeOffset={props.setTimeOffset}
          titleDuration={props.titleDuration}
          setTitleDuration={props.setTitleDuration}
        />
      </div>
    </PageShell>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatLanguages(languages: string[]): string {
  if (languages.length === 1 && languages[0] === "original") return "Original";
  return languages.map(l => l.toUpperCase()).join(" · ");
}

function HistorialView() {
  const t = useT();
  const [filter, setFilter] = useState<"all" | "done" | "error">("all");
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHistory()
      .then(data => setJobs(data))
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === "all" ? jobs : jobs.filter(j => j.status === filter);

  const filterLabel = (f: "all" | "done" | "error") => {
    if (f === "all") return t.historial.filterAll;
    if (f === "done") return t.historial.filterDone;
    return t.historial.filterProcessing;
  };

  const jobsLabel = filtered.length !== 1 ? t.historial.jobs_other : t.historial.jobs_one;

  return (
    <PageShell title={t.historial.title} subtitle={t.historial.subtitle}>
      <div style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
      }}>
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
            {loading ? "—" : filtered.length} {jobsLabel}
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {(["all", "done", "error"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  border: "1px solid",
                  borderColor: filter === f ? "var(--accent-border)" : "var(--border)",
                  background: filter === f ? "var(--accent-subtle)" : "var(--bg-card)",
                  color: filter === f ? "var(--accent)" : "var(--text-secondary)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                }}
              >
                {filterLabel(f)}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: "40px 20px", textAlign: "center", fontSize: 13, color: "var(--text-tertiary)" }}>
            Loading…
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {[t.recentJobs.colFile, t.recentJobs.colLangs, t.recentJobs.colModel, t.recentJobs.colDate, t.recentJobs.colStatus].map(h => (
                  <th key={h} style={{
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: "var(--text-tertiary)",
                    textAlign: "left",
                    padding: "10px 16px",
                    borderBottom: "1px solid var(--border)",
                    background: "var(--bg-subtle)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((job, i) => (
                <tr key={job.id} style={{ transition: "background 0.1s" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-subtle)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}
                >
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-primary)", fontWeight: 500, borderBottom: i < filtered.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                    {job.filename}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-secondary)", borderBottom: i < filtered.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                    {formatLanguages(job.languages)}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)", fontFamily: "var(--font-geist-mono), monospace", borderBottom: i < filtered.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                    {job.model}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-secondary)", borderBottom: i < filtered.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                    {formatDate(job.created_at)}
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: i < filtered.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                    <StatusTag status={job.status} />
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: "40px 20px", textAlign: "center", fontSize: 13, color: "var(--text-tertiary)" }}>
                    No jobs found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        <div style={{
          padding: "10px 16px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font-geist-mono), monospace" }}>
            {jobs.length} {t.historial.total}
          </span>
        </div>
      </div>
    </PageShell>
  );
}

function ConfiguracionView({
  outputFolder,
  onOutputFolderChange,
  anthropicKey,
  onAnthropicKeyChange,
  cookiesFile,
  onCookiesFileChange,
}: {
  outputFolder: string;
  onOutputFolderChange: (folder: string) => void;
  anthropicKey: string;
  onAnthropicKeyChange: (key: string) => void;
  cookiesFile: string;
  onCookiesFileChange: (path: string) => void;
}) {
  const t = useT();
  const [folderInput, setFolderInput] = useState(outputFolder);
  const [keyInput, setKeyInput] = useState(anthropicKey);
  const [cookiesInput, setCookiesInput] = useState(cookiesFile);
  const [feedback, setFeedback] = useState<"" | "saved" | "error">("");

  useEffect(() => { setFolderInput(outputFolder); }, [outputFolder]);
  useEffect(() => { setKeyInput(anthropicKey); }, [anthropicKey]);
  useEffect(() => { setCookiesInput(cookiesFile); }, [cookiesFile]);

  const handleSave = async () => {
    try {
      const result = await saveConfig({ output_folder: folderInput, anthropic_api_key: keyInput, cookies_file: cookiesInput });
      onOutputFolderChange(result.output_folder);
      onAnthropicKeyChange(result.anthropic_api_key);
      onCookiesFileChange(result.cookies_file);
      setFeedback("saved");
    } catch {
      setFeedback("error");
    }
    setTimeout(() => setFeedback(""), 2500);
  };

  const saveBtnLabel = feedback === "saved" ? t.config.saveBtnSaved : feedback === "error" ? t.config.saveBtnError : t.config.saveBtnDefault;

  return (
    <PageShell title={t.config.title} subtitle={t.config.subtitle}>
      <div style={{ maxWidth: 540, display: "flex", flexDirection: "column", gap: 12 }}>
        <Section title={t.config.outputFolder} description={t.config.outputFolderDesc}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              value={folderInput}
              onChange={e => setFolderInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSave()}
              placeholder={t.config.outputFolderPlaceholder}
              style={{
                flex: 1,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text-primary)",
                fontSize: 13,
                padding: "8px 10px",
                borderRadius: 7,
                fontFamily: "var(--font-geist-mono), monospace",
                outline: "none",
              }}
            />
            <button
              onClick={handleSave}
              style={{
                height: 36,
                padding: "0 14px",
                border: "1px solid",
                borderColor: feedback === "saved" ? "var(--success)" : feedback === "error" ? "#ef4444" : "var(--border)",
                background: feedback === "saved" ? "var(--success-subtle)" : feedback === "error" ? "rgba(239,68,68,0.08)" : "var(--bg-card)",
                color: feedback === "saved" ? "var(--success)" : feedback === "error" ? "#ef4444" : "var(--text-secondary)",
                borderRadius: 7,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.15s",
                whiteSpace: "nowrap",
              }}
            >
              {saveBtnLabel}
            </button>
          </div>
          {outputFolder && (
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 6, fontFamily: "var(--font-geist-mono), monospace" }}>
              {t.config.currentFolder} {outputFolder}
            </div>
          )}
        </Section>

        <Section title={t.config.app} description={t.config.appDesc}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
            <div>
              <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>{t.config.theme}</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{t.config.themeDesc}</div>
            </div>
            <ThemeToggle />
          </div>
        </Section>

        <Section title={t.config.anthropicKey} description={t.config.anthropicKeyDesc}>
          <input
            type="password"
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            placeholder={t.config.anthropicKeyPlaceholder}
            style={{
              width: "100%",
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-primary)",
              fontSize: 13,
              padding: "8px 10px",
              borderRadius: 7,
              fontFamily: "var(--font-geist-mono), monospace",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={handleSave}
            style={{
              marginTop: 8,
              height: 34,
              padding: "0 14px",
              border: "1px solid",
              borderColor: feedback === "saved" ? "var(--success)" : feedback === "error" ? "#ef4444" : "var(--border)",
              background: feedback === "saved" ? "var(--success-subtle)" : feedback === "error" ? "rgba(239,68,68,0.08)" : "var(--bg-card)",
              color: feedback === "saved" ? "var(--success)" : feedback === "error" ? "#ef4444" : "var(--text-secondary)",
              borderRadius: 7,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.15s",
            }}
          >
            {feedback === "saved" ? t.config.saveBtnSaved : feedback === "error" ? t.config.saveBtnError : t.config.saveBtnDefault}
          </button>
        </Section>

        <Section title={t.config.cookiesFile} description={t.config.cookiesFileDesc}>
          <input
            type="text"
            value={cookiesInput}
            onChange={e => setCookiesInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            placeholder={t.config.cookiesFilePlaceholder}
            style={{
              width: "100%",
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-primary)",
              fontSize: 13,
              padding: "8px 10px",
              borderRadius: 7,
              fontFamily: "var(--font-geist-mono), monospace",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={handleSave}
            style={{
              marginTop: 8,
              height: 34,
              padding: "0 14px",
              border: "1px solid",
              borderColor: feedback === "saved" ? "var(--success)" : feedback === "error" ? "#ef4444" : "var(--border)",
              background: feedback === "saved" ? "var(--success-subtle)" : feedback === "error" ? "rgba(239,68,68,0.08)" : "var(--bg-card)",
              color: feedback === "saved" ? "var(--success)" : feedback === "error" ? "#ef4444" : "var(--text-secondary)",
              borderRadius: 7,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.15s",
            }}
          >
            {feedback === "saved" ? t.config.saveBtnSaved : feedback === "error" ? t.config.saveBtnError : t.config.saveBtnDefault}
          </button>
        </Section>

        <Section title={t.config.models} description={t.config.modelsDesc}>
          <div style={{ padding: "10px 0", display: "flex", flexDirection: "column", gap: 8 }}>
            <ModelRow name="Whisper large-v3" desc="GPU local · RTX 2060 · 6 GB VRAM" status={t.config.modelAvailable} ok />
            <ModelRow name="Google Translate" desc="API pública gratuita, sin clave" status={t.config.modelAvailable} ok />
            <ModelRow name="Claude Haiku / Sonnet" desc="Requiere API key de Anthropic" status={t.config.modelNotConfigured} ok={false} />
          </div>
        </Section>
      </div>
    </PageShell>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--bg)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      overflow: "hidden",
    }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-primary)" }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{description}</div>
      </div>
      <div style={{ padding: "16px 20px" }}>{children}</div>
    </div>
  );
}

function ModelRow({ name, desc, status, ok }: { name: string; desc: string; status: string; ok: boolean }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "8px 0",
      borderBottom: "1px solid var(--border-subtle)",
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{name}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{desc}</div>
      </div>
      <span style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 5,
        fontFamily: "var(--font-geist-mono), monospace",
        background: ok ? "var(--success-subtle)" : "var(--bg-card)",
        color: ok ? "var(--success)" : "var(--text-tertiary)",
        border: ok ? "1px solid rgba(34,197,94,0.2)" : "1px solid var(--border)",
      }}>
        {status}
      </span>
    </div>
  );
}

interface WorkflowCardProps {
  fileEntries: FileEntry[];
  progress: { status: string; percent: number };
  processing: boolean;
  results: Record<string, Record<string, string>>;
  detectedLanguages: Record<string, string>;
  isDragging: boolean;
  hasResults: boolean;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onPickFiles: () => void;
  onDownload: (filename: string, lang: string, content: string) => void;
  onDownloadZip: () => void;
  onUpdateTitle: (filename: string, title: string) => void;
  onAddUrl: (url: string) => void;
  onRemoveEntry: (name: string) => void;
  onOpenEditor: (name: string) => void;
  editedFiles: Set<string>;
}

function WorkflowCard({ fileEntries, progress, processing, results, detectedLanguages, isDragging, hasResults, onDrop, onDragOver, onDragLeave, onPickFiles, onDownload, onDownloadZip, onUpdateTitle, onAddUrl, onRemoveEntry, onOpenEditor, editedFiles }: WorkflowCardProps) {
  const t = useT();
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState(false);
  const getFileType = (name: string) => name.split(".").pop()?.toLowerCase() === "srt" ? "srt" : "mp4";

  const formatSize = (bytes: number) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
    return `${(bytes / 1e3).toFixed(0)} KB`;
  };

  const handleAddUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed.startsWith("http")) {
      setUrlError(true);
      return;
    }
    setUrlError(false);
    onAddUrl(trimmed);
    setUrlInput("");
  };

  const showProgress = processing || (progress.percent > 0 && progress.percent < 100);

  return (
    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{t.workflow.title}</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 1 }}>{t.workflow.subtitle}</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {hasResults && (
            <CardAction onClick={onDownloadZip}>↓ ZIP</CardAction>
          )}
          <CardAction onClick={onPickFiles}>{t.workflow.addFiles}</CardAction>
        </div>
      </div>

      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={onPickFiles}
        style={{
          margin: 20,
          border: `1px ${isDragging ? "solid" : "dashed"} ${isDragging ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 10,
          padding: "36px 20px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          background: isDragging ? "var(--accent-subtle)" : "var(--bg-subtle)",
          transition: "border-color 0.2s, background 0.2s",
        }}
        onMouseEnter={e => {
          if (isDragging) return;
          const el = e.currentTarget as HTMLDivElement;
          el.style.borderColor = "var(--text-tertiary)";
          el.style.background = "var(--bg-card)";
        }}
        onMouseLeave={e => {
          if (isDragging) return;
          const el = e.currentTarget as HTMLDivElement;
          el.style.borderColor = "var(--border)";
          el.style.background = "var(--bg-subtle)";
        }}
      >
        <div style={{
          width: 40, height: 40,
          borderRadius: 10,
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: isDragging ? "var(--accent)" : "var(--text-secondary)",
        }}>
          <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
            <path d="M10 3v10M6 7l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 17h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <div style={{ fontSize: 13.5, color: "var(--text-secondary)", textAlign: "center" }}>
          <strong style={{ color: "var(--accent)", fontWeight: 500 }}>{t.workflow.clickToUpload}</strong>{" "}{t.workflow.orDrag}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", fontFamily: "var(--font-geist-mono), monospace" }}>
          {t.workflow.formats}
        </div>
      </div>

      {/* URL input row */}
      <div style={{ margin: "0 20px 16px", display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", whiteSpace: "nowrap", minWidth: 0 }}>
          {t.workflow.urlInputLabel}
        </div>
        <input
          type="text"
          value={urlInput}
          onChange={e => { setUrlInput(e.target.value); setUrlError(false); }}
          onKeyDown={e => e.key === "Enter" && handleAddUrl()}
          placeholder={t.workflow.urlInputPlaceholder}
          style={{
            flex: 1,
            border: `1px solid ${urlError ? "#ef4444" : "var(--border)"}`,
            background: "var(--bg-subtle)",
            color: "var(--text-primary)",
            fontSize: 12,
            padding: "5px 8px",
            borderRadius: 6,
            fontFamily: "var(--font-geist-mono), monospace",
            outline: "none",
            minWidth: 0,
          }}
        />
        <button
          onClick={handleAddUrl}
          style={{
            height: 28,
            padding: "0 10px",
            border: "1px solid var(--border)",
            background: "var(--bg-card)",
            color: "var(--text-secondary)",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {t.workflow.urlInputBtn}
        </button>
      </div>

      {fileEntries.length > 0 && (
        <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          {fileEntries.map(entry => {
            const isUrl = !!entry.url;
            const type = isUrl ? "url" : getFileType(entry.name);
            const fileResults = results[entry.name];

            return (
              <div key={entry.name}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "var(--bg-subtle)",
                }}>
                  <div style={{
                    width: 32, height: 32,
                    borderRadius: 7,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: "var(--font-geist-mono), monospace",
                    flexShrink: 0,
                    background: isUrl ? "rgba(139,92,246,0.1)" : type === "srt" ? "var(--accent-subtle)" : "var(--cyan-subtle)",
                    color: isUrl ? "#8b5cf6" : type === "srt" ? "var(--accent)" : "var(--cyan)",
                    border: isUrl ? "1px solid rgba(139,92,246,0.25)" : type === "srt" ? "1px solid var(--accent-border)" : "1px solid rgba(6,182,212,0.25)",
                  }}>
                    {isUrl ? (
                      <svg viewBox="0 0 14 14" fill="none" width="13" height="13">
                        <path d="M5.5 8.5a3 3 0 004.243 0l1.414-1.414a3 3 0 00-4.243-4.243L6.207 4.05" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        <path d="M8.5 5.5a3 3 0 00-4.243 0L2.843 6.914a3 3 0 004.243 4.243L7.793 9.95" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      </svg>
                    ) : type.toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>
                      {entry.name}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", fontFamily: "var(--font-geist-mono), monospace", marginTop: 1 }}>
                      {isUrl ? "URL" : formatSize(entry.file?.size ?? 0)}
                    </div>
                    {(entry.status === "waiting" || entry.status === "done") && (
                      <input
                        type="text"
                        value={entry.title}
                        onChange={e => onUpdateTitle(entry.name, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        style={{
                          marginTop: 5,
                          width: "100%",
                          border: "1px solid var(--border)",
                          background: "transparent",
                          color: "var(--text-secondary)",
                          fontSize: 12,
                          padding: "3px 6px",
                          borderRadius: 4,
                          outline: "none",
                          fontFamily: "inherit",
                          boxSizing: "border-box",
                        }}
                      />
                    )}
                  </div>
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", flexShrink: 0 }}>
                    {entry.status !== "processing" && (
                      <button
                        onClick={e => { e.stopPropagation(); onRemoveEntry(entry.name); }}
                        title="Quitar"
                        style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 14, padding: "2px 4px", borderRadius: 4, lineHeight: 1, display: "flex", alignItems: "center" }}
                        onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                        onMouseLeave={e => (e.currentTarget.style.color = "var(--text-tertiary)")}
                      >
                        <svg viewBox="0 0 14 14" fill="none" width="13" height="13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                          <path d="M2 3.5h10M5.5 3.5V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M5.5 6v4.5M8.5 6v4.5M3 3.5l.7 7.3a.5.5 0 00.5.45h5.6a.5.5 0 00.5-.45L11 3.5" />
                        </svg>
                      </button>
                    )}
                    {detectedLanguages[entry.name] && (
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        fontFamily: "var(--font-geist-mono), monospace",
                        padding: "1px 6px", borderRadius: 4,
                        background: "var(--cyan-subtle)",
                        color: "var(--cyan)",
                        border: "1px solid rgba(6,182,212,0.25)",
                      }}>
                        {detectedLanguages[entry.name]}
                      </span>
                    )}
                    <div style={{
                      width: 6, height: 6,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: entry.status === "done" ? "var(--success)" : entry.status === "processing" ? "var(--accent)" : entry.status === "error" ? "#ef4444" : "var(--text-tertiary)",
                      animation: entry.status === "processing" ? "pulse 1.5s infinite" : "none",
                    }} />
                    {entry.statusLabel}
                  </div>
                </div>

                {fileResults && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "6px 12px 0" }}>
                    <button
                      onClick={() => onOpenEditor(entry.name)}
                      style={{
                        padding: "3px 10px",
                        borderRadius: 5,
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: "var(--font-geist-mono), monospace",
                        border: "1px solid var(--border)",
                        background: "var(--bg-card)",
                        color: "var(--text-secondary)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      ✏ Edit
                      {editedFiles.has(entry.name) && (
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#eab308", flexShrink: 0, display: "inline-block" }} />
                      )}
                    </button>
                    {Object.entries(fileResults).map(([lang, content]) => {
                      const isOriginal = lang === "original";
                      return (
                        <button
                          key={lang}
                          onClick={() => onDownload(entry.name, lang, content)}
                          style={{
                            padding: "3px 10px",
                            borderRadius: 5,
                            fontSize: 11,
                            fontWeight: 600,
                            fontFamily: "var(--font-geist-mono), monospace",
                            border: isOriginal ? "1px solid var(--border)" : "1px solid var(--accent-border)",
                            background: isOriginal ? "var(--bg-card)" : "var(--accent-subtle)",
                            color: isOriginal ? "var(--text-secondary)" : "var(--accent)",
                            cursor: "pointer",
                          }}
                        >
                          ↓ {isOriginal ? "SRT" : lang.toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showProgress && (
        <div style={{ padding: "0 20px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 8, fontFamily: "var(--font-geist-mono), monospace" }}>
            <span>{progress.status}</span>
            <span>{progress.percent}%</span>
          </div>
          <div style={{ height: 3, background: "var(--border)", borderRadius: 99, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress.percent}%`, background: "linear-gradient(90deg, var(--accent), var(--cyan))", borderRadius: 99, transition: "width 0.3s ease" }} />
          </div>
        </div>
      )}
    </div>
  );
}

const insertTypeStyle: Record<string, { bg: string; color: string; border: string }> = {
  player:  { bg: "var(--accent-subtle)",   color: "var(--accent)",  border: "var(--accent-border)" },
  club:    { bg: "rgba(6,182,212,0.08)",   color: "var(--cyan)",    border: "rgba(6,182,212,0.25)" },
  visual:  { bg: "var(--success-subtle)",  color: "var(--success)", border: "rgba(34,197,94,0.2)" },
};

function InsertsCard({ inserts, hasTranscription, hasApiKey }: {
  inserts: InsertSuggestion[];
  hasTranscription: boolean;
  hasApiKey: boolean;
}) {
  const t = useT();

  return (
    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{t.inserts.title}</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 1 }}>{t.inserts.subtitle}</div>
        </div>
        {inserts.length > 0 && (
          <span style={{ fontSize: 11, fontFamily: "var(--font-geist-mono), monospace", color: "var(--text-tertiary)" }}>
            {inserts.length} {t.inserts.suggestions}
          </span>
        )}
      </div>

      {inserts.length === 0 ? (
        <div style={{ padding: "40px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: "var(--bg-subtle)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 16 16" fill="none" width="15" height="15">
              <rect x="2" y="3" width="12" height="10" rx="2" stroke="var(--text-tertiary)" strokeWidth="1.2" />
              <path d="M5 7h6M5 10h4" stroke="var(--text-tertiary)" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ fontSize: 13, color: "var(--text-tertiary)", textAlign: "center" }}>
            {!hasApiKey ? t.inserts.emptyNoKey : !hasTranscription ? t.inserts.empty : t.inserts.emptyAnalyzing}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {inserts.map((s, i) => {
            const style = insertTypeStyle[s.type] ?? insertTypeStyle.visual;
            const typeLabel = t.inserts.types[s.type as keyof typeof t.inserts.types] ?? s.type;
            return (
              <div key={i} style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "12px 20px",
                borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none",
              }}>
                <div style={{ fontSize: 11.5, fontFamily: "var(--font-geist-mono), monospace", color: "var(--text-tertiary)", whiteSpace: "nowrap", paddingTop: 2, minWidth: 64 }}>
                  {s.timecode}
                </div>
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 7px",
                  borderRadius: 4,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  fontFamily: "var(--font-geist-mono), monospace",
                  background: style.bg,
                  color: style.color,
                  border: `1px solid ${style.border}`,
                }}>
                  {typeLabel}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.4 }}>
                    {s.text}{s.text.length >= 90 ? "…" : ""}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 3, fontStyle: "italic" }}>
                    {s.suggestion}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecentJobsCard() {
  const t = useT();
  const [jobs, setJobs] = useState<HistoryJob[]>([]);

  useEffect(() => {
    getHistory().then(data => setJobs(data.slice(0, 4)));
  }, []);

  return (
    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{t.recentJobs.title}</div>
        <CardAction>{t.recentJobs.viewAll}</CardAction>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {[t.recentJobs.colFile, t.recentJobs.colLangs, t.recentJobs.colModel, t.recentJobs.colDate, t.recentJobs.colStatus].map(h => (
              <th key={h} style={{ fontSize: 11.5, fontWeight: 500, color: "var(--text-tertiary)", textAlign: "left", padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-subtle)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: "28px 20px", textAlign: "center", fontSize: 13, color: "var(--text-tertiary)" }}>
                —
              </td>
            </tr>
          ) : jobs.map((job, i) => (
            <tr key={job.id}>
              <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-primary)", fontWeight: 500, borderBottom: i < jobs.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>{job.filename}</td>
              <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-secondary)", borderBottom: i < jobs.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>{formatLanguages(job.languages)}</td>
              <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)", fontFamily: "var(--font-geist-mono), monospace", borderBottom: i < jobs.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>{job.model}</td>
              <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-secondary)", borderBottom: i < jobs.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>{formatDate(job.created_at)}</td>
              <td style={{ padding: "12px 16px", borderBottom: i < jobs.length - 1 ? "1px solid var(--border-subtle)" : "none" }}><StatusTag status={job.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RightPanel({
  selectedLangs,
  toggleLang,
  selectedModel,
  setSelectedModel,
  pendingCount,
  processing,
  onProcess,
  hasVideoFiles,
  onNewJob,
  hasResults,
  outputFolder,
  onOutputFolderChange,
  onGoToConfig,
  lineMode,
  setLineMode,
  timeOffset,
  setTimeOffset,
  titleDuration,
  setTitleDuration,
}: {
  selectedLangs: string[];
  toggleLang: (lang: string) => void;
  selectedModel: TranslationModel;
  setSelectedModel: (m: TranslationModel) => void;
  pendingCount: number;
  processing: boolean;
  hasVideoFiles: boolean;
  onProcess: () => void;
  onNewJob: () => void;
  hasResults: boolean;
  outputFolder: string;
  onOutputFolderChange: (folder: string) => void;
  onGoToConfig: () => void;
  lineMode: 1 | 2;
  setLineMode: (m: 1 | 2) => void;
  timeOffset: number;
  setTimeOffset: React.Dispatch<React.SetStateAction<number>>;
  titleDuration: number;
  setTitleDuration: React.Dispatch<React.SetStateAction<number>>;
}) {
  const t = useT();
  const [folderInput, setFolderInput] = useState(outputFolder);
  const [folderFeedback, setFolderFeedback] = useState<"" | "saved" | "error">("");

  useEffect(() => { setFolderInput(outputFolder); }, [outputFolder]);

  const handleSaveFolder = async () => {
    try {
      const result = await saveConfig({ output_folder: folderInput });
      onOutputFolderChange(result.output_folder);
      setFolderFeedback("saved");
    } catch {
      setFolderFeedback("error");
    }
    setTimeout(() => setFolderFeedback(""), 2500);
  };

  const noFolder = !outputFolder;
  const processDisabled = processing || pendingCount === 0;

  const folderBtnLabel = folderFeedback === "saved" ? t.config.saveBtnSaved : folderFeedback === "error" ? t.config.saveBtnError : t.config.saveBtnDefault;

  const processBtnLabel = processing
    ? t.jobConfig.btnProcessing
    : pendingCount === 0
    ? t.jobConfig.btnNoFiles
    : pendingCount === 1
    ? t.jobConfig.btnProcess_one
    : t.jobConfig.btnProcess_other.replace("{{count}}", String(pendingCount));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{t.jobConfig.title}</div>
        </div>

        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
          <ConfigLabel>{t.jobConfig.outputFolder}</ConfigLabel>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="text"
              value={folderInput}
              onChange={e => setFolderInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSaveFolder()}
              placeholder={t.config.outputFolderPlaceholder}
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg-subtle)",
                color: "var(--text-primary)",
                fontSize: 12,
                padding: "5px 8px",
                borderRadius: 6,
                flex: 1,
                fontFamily: "var(--font-geist-mono), monospace",
                outline: "none",
              }}
            />
            <button
              onClick={handleSaveFolder}
              style={{
                height: 28,
                padding: "0 10px",
                border: "1px solid",
                borderColor: folderFeedback === "saved" ? "var(--success)" : folderFeedback === "error" ? "#ef4444" : "var(--border)",
                background: folderFeedback === "saved" ? "var(--success-subtle)" : folderFeedback === "error" ? "rgba(239,68,68,0.08)" : "var(--bg-card)",
                color: folderFeedback === "saved" ? "var(--success)" : folderFeedback === "error" ? "#ef4444" : "var(--text-secondary)",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.15s",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {folderBtnLabel}
            </button>
          </div>
        </div>

        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)", opacity: hasVideoFiles ? 0.4 : 1, pointerEvents: hasVideoFiles ? "none" : "auto" }}>
          <ConfigLabel>
            {t.jobConfig.targetLangs}{hasVideoFiles && <span style={{ fontSize: 10, fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: 6, color: "var(--text-tertiary)" }}>{t.jobConfig.targetLangsVideoNote}</span>}
          </ConfigLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <LanguagePill lang="ES" source selected={selectedLangs.includes("ES")} onClick={() => toggleLang("ES")} />
            <div style={{ width: 1, background: "var(--border)", alignSelf: "stretch", margin: "0 2px" }} />
            {languages.map(lang => (
              <LanguagePill key={lang} lang={lang} selected={selectedLangs.includes(lang)} onClick={() => toggleLang(lang)} />
            ))}
          </div>
        </div>

        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)", opacity: hasVideoFiles ? 0.4 : 1, pointerEvents: hasVideoFiles ? "none" : "auto" }}>
          <ConfigLabel>{t.jobConfig.translationModel}</ConfigLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <ModelOption selected={selectedModel === "google"} name="Google Translate" desc={t.jobConfig.modelFastDesc} tag="FREE" tagType="free" onClick={() => setSelectedModel("google")} />
            <ModelOption selected={selectedModel === "haiku"} name="Claude Haiku" desc={t.jobConfig.modelHaikuDesc} tag="API" tagType="paid" onClick={() => setSelectedModel("haiku")} />
            <ModelOption selected={selectedModel === "sonnet"} name="Claude Sonnet" desc={t.jobConfig.modelSonnetDesc} tag="API" tagType="paid" onClick={() => setSelectedModel("sonnet")} />
          </div>
        </div>

        {hasVideoFiles && (
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
            <ConfigLabel>{t.jobConfig.transcription}</ConfigLabel>
            <ModelOption selected name="Whisper large-v3" desc="GPU local · RTX 2060" tag="LOCAL" tagType="free" />
          </div>
        )}

        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
          <ConfigLabel>{t.jobConfig.subtitleFormat}</ConfigLabel>
          <div style={{ display: "flex", gap: 6 }}>
            {([1, 2] as const).map(n => (
              <button
                key={n}
                onClick={() => setLineMode(n)}
                style={{
                  flex: 1,
                  padding: "7px 10px",
                  borderRadius: 7,
                  border: lineMode === n ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: lineMode === n ? "var(--accent-subtle)" : "var(--bg-card)",
                  color: lineMode === n ? "var(--accent)" : "var(--text-secondary)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                  textAlign: "left" as const,
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>
                  {n === 1 ? t.jobConfig.subtitleLines1 : t.jobConfig.subtitleLines2}
                </div>
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 1 }}>
                  {n === 1 ? t.jobConfig.subtitleLines1Desc : t.jobConfig.subtitleLines2Desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
          <ConfigLabel>{t.jobConfig.timingOffset}</ConfigLabel>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setTimeOffset(v => Math.round((v - 0.5) * 10) / 10)}
              style={{ height: 26, width: 28, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)", borderRadius: 6, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            >
              −
            </button>
            <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 13, minWidth: 52, textAlign: "center", color: timeOffset !== 0 ? "var(--accent)" : "var(--text-primary)" }}>
              {timeOffset > 0 ? `+${timeOffset}s` : `${timeOffset}s`}
            </span>
            <button
              onClick={() => setTimeOffset(v => Math.round((v + 0.5) * 10) / 10)}
              style={{ height: 26, width: 28, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)", borderRadius: 6, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            >
              +
            </button>
            {timeOffset !== 0 && (
              <button
                onClick={() => setTimeOffset(0)}
                style={{ height: 26, padding: "0 8px", border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-tertiary)", borderRadius: 6, cursor: "pointer", fontSize: 12, flexShrink: 0 }}
              >
                ↺
              </button>
            )}
          </div>
        </div>

        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
          <ConfigLabel>{t.jobConfig.titleDuration}</ConfigLabel>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setTitleDuration(v => Math.max(1, v - 1))}
              style={{ height: 26, width: 28, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)", borderRadius: 6, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            >
              −
            </button>
            <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 13, minWidth: 40, textAlign: "center", color: "var(--text-primary)" }}>
              {titleDuration}s
            </span>
            <button
              onClick={() => setTitleDuration(v => Math.min(10, v + 1))}
              style={{ height: 26, width: 28, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)", borderRadius: 6, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            >
              +
            </button>
          </div>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          {noFolder && (
            <button
              onClick={onGoToConfig}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "rgba(239,68,68,0.06)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 8,
                fontSize: 12,
                color: "#ef4444",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              {t.jobConfig.folderWarning}
            </button>
          )}
          <button
            disabled={processDisabled}
            onClick={onProcess}
            style={{
              width: "100%",
              height: 40,
              background: processDisabled ? "var(--bg-card)" : "var(--accent)",
              color: processDisabled ? "var(--text-tertiary)" : "white",
              border: processDisabled ? "1px solid var(--border)" : "none",
              borderRadius: 9,
              fontSize: 14,
              fontWeight: 500,
              cursor: processDisabled ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              transition: "all 0.15s",
            }}
          >
            <svg viewBox="0 0 16 16" fill="none" width="15" height="15">
              <path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {processBtnLabel}
          </button>

          {hasResults && !processing && (
            <button
              onClick={onNewJob}
              style={{
                width: "100%",
                height: 34,
                background: "none",
                color: "var(--text-secondary)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {t.jobConfig.btnNewJob}
            </button>
          )}
        </div>
      </div>

      {outputFolder && (
        <div style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "12px 16px",
          display: "flex",
          gap: 8,
          alignItems: "flex-start",
        }}>
          <div style={{ color: "var(--success)", marginTop: 1, flexShrink: 0 }}>
            <svg viewBox="0 0 14 14" fill="none" width="13" height="13">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M4.5 7l2 2 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 500, color: "var(--text-primary)", marginBottom: 2 }}>{t.jobConfig.folderSetTitle}</div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-geist-mono), monospace", wordBreak: "break-all" }}>
              {outputFolder}
            </div>
          </div>
        </div>
      )}

      {hasVideoFiles && (
        <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--accent-subtle)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg viewBox="0 0 14 14" fill="none" width="13" height="13">
                <circle cx="7" cy="7" r="5.5" stroke="var(--accent)" strokeWidth="1.2" />
                <path d="M7 5v3M7 9.5v.5" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-primary)", marginBottom: 3 }}>{t.jobConfig.gpuTitle}</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>{t.jobConfig.gpuDesc}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusTag({ status }: { status: string }) {
  const t = useT();
  const map: Record<string, { bg: string; color: string; border?: string; label: string }> = {
    done: { bg: "var(--success-subtle)", color: "var(--success)", label: t.status.done },
    processing: { bg: "var(--accent-subtle)", color: "var(--accent)", label: t.status.processing },
    queued: { bg: "var(--bg-card)", color: "var(--text-tertiary)", border: "1px solid var(--border)", label: t.status.queued },
  };
  const s = map[status] ?? { bg: "var(--bg-card)", color: "var(--text-tertiary)", label: status };
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "2px 8px",
      borderRadius: 5,
      fontSize: 11,
      fontWeight: 600,
      fontFamily: "var(--font-geist-mono), monospace",
      background: s.bg,
      color: s.color,
      border: s.border,
    }}>
      {s.label}
    </span>
  );
}

function LanguagePill({ lang, selected, onClick, source }: { lang: string; selected?: boolean; onClick?: () => void; source?: boolean }) {
  return (
    <div onClick={onClick} style={{
      padding: "5px 11px",
      borderRadius: 6,
      fontSize: 12,
      fontWeight: 500,
      cursor: "pointer",
      border: `1px ${source ? "dashed" : "solid"} ${selected ? "var(--accent-border)" : "var(--border)"}`,
      background: selected ? "var(--accent-subtle)" : "var(--bg-card)",
      color: selected ? "var(--accent)" : "var(--text-secondary)",
      transition: "all 0.15s",
      fontFamily: "var(--font-geist-mono), monospace",
    }}>
      {lang}
    </div>
  );
}

function ConfigLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11.5, fontWeight: 500, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
      {children}
    </div>
  );
}

function ModelOption({ selected, name, desc, tag, tagType, onClick }: { selected?: boolean; name: string; desc: string; tag: string; tagType: "free" | "paid"; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "9px 12px",
      borderRadius: 8,
      border: selected ? "1px solid var(--accent)" : "1px solid var(--border)",
      cursor: onClick ? "pointer" : "default",
      background: selected ? "var(--accent-subtle)" : "var(--bg-card)",
      transition: "all 0.15s",
    }}>
      <div style={{
        width: 14, height: 14,
        borderRadius: "50%",
        border: selected ? "1.5px solid var(--accent)" : "1.5px solid var(--border)",
        background: selected ? "var(--accent)" : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        transition: "all 0.15s",
      }}>
        {selected && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "white" }} />}
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{name}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{desc}</div>
      </div>
      <span style={{
        marginLeft: "auto",
        fontSize: 10,
        fontWeight: 600,
        fontFamily: "var(--font-geist-mono), monospace",
        padding: "2px 6px",
        borderRadius: 4,
        background: tagType === "free" ? "var(--success-subtle)" : "var(--accent-subtle)",
        color: tagType === "free" ? "var(--success)" : "var(--accent)",
      }}>
        {tag}
      </span>
    </div>
  );
}

function CardAction({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 30,
        padding: "0 12px",
        border: "1px solid var(--border)",
        background: "var(--bg-card)",
        borderRadius: 7,
        fontSize: 12.5,
        color: "var(--text-secondary)",
        cursor: "pointer",
        transition: "all 0.15s",
        fontFamily: "inherit",
        fontWeight: 500,
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.borderColor = "var(--accent-border)";
        el.style.color = "var(--accent)";
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.borderColor = "var(--border)";
        el.style.color = "var(--text-secondary)";
      }}
    >
      {children}
    </button>
  );
}

interface SrtBlock {
  index: number;
  timecode: string;
  text: string;
}

function parseSrt(srt: string): SrtBlock[] {
  return srt.trim().split(/\n\n+/).map(block => {
    const lines = block.trim().split("\n");
    return {
      index: parseInt(lines[0]) || 0,
      timecode: lines[1] ?? "",
      text: lines.slice(2).join("\n"),
    };
  }).filter(b => !!b.timecode);
}

function serializeSrt(blocks: SrtBlock[]): string {
  return blocks.map(b => `${b.index}\n${b.timecode}\n${b.text}`).join("\n\n");
}

function EditorView({ filename, srt, onSave, onCancel }: {
  filename: string;
  srt: string;
  onSave: (srt: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [blocks, setBlocks] = useState<SrtBlock[]>(() => parseSrt(srt));
  const [showFR, setShowFR] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const findRef = React.useRef<HTMLInputElement>(null);

  const matchCount = findText
    ? blocks.filter(b => b.text.toLowerCase().includes(findText.toLowerCase())).length
    : 0;

  const replaceAll = () => {
    if (!findText) return;
    setBlocks(prev => prev.map(b => ({
      ...b,
      text: b.text.split(findText).join(replaceText),
    })));
  };

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "h") {
        e.preventDefault();
        setShowFR(v => !v);
        setTimeout(() => findRef.current?.focus(), 50);
      }
      if (e.key === "Escape") setShowFR(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const updateBlock = (index: number, text: string) => {
    setBlocks(prev => prev.map((b, i) => i === index ? { ...b, text } : b));
  };

  const splitBlock = (index: number) => {
    setBlocks(prev => {
      const block = prev[index];
      const [startTs, endTs] = block.timecode.split(" --> ");
      const toMs = (ts: string) => {
        const [h, m, rest] = ts.split(":");
        const [s, ms] = rest.split(",");
        return ((+h * 3600 + +m * 60 + +s) * 1000) + +ms;
      };
      const toTs = (ms: number) => {
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        const msR = ms % 1000;
        return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(msR).padStart(3,"0")}`;
      };
      const startMs = toMs(startTs);
      const endMs = toMs(endTs);
      const midMs = Math.floor((startMs + endMs) / 2);
      const lines = block.text.split("\n");
      const mid = Math.ceil(lines.length / 2);
      const textA = lines.slice(0, mid).join("\n");
      const textB = lines.slice(mid).join("\n") || "…";
      const blockA = { index: block.index, timecode: `${startTs} --> ${toTs(midMs)}`, text: textA };
      const blockB = { index: block.index + 1, timecode: `${toTs(midMs)} --> ${endTs}`, text: textB };
      const next = [...prev.slice(0, index), blockA, blockB, ...prev.slice(index + 1)];
      return next.map((b, i) => ({ ...b, index: i + 1 }));
    });
  };

  const handleSave = () => {
    onSave(serializeSrt(blocks));
  };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: showFR ? 16 : 28 }}>
        <div>
          <button
            onClick={onCancel}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "none", border: "none", cursor: "pointer",
              color: "var(--text-secondary)", fontSize: 13, fontFamily: "inherit",
              marginBottom: 8, padding: 0,
            }}
          >
            ← {t.editor.backToPanel}
          </button>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", color: "var(--text-primary)" }}>
            {t.editor.title}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2, fontFamily: "var(--font-geist-mono), monospace" }}>
            {filename} · {blocks.length} {t.editor.blocks}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => { setShowFR(v => !v); setTimeout(() => findRef.current?.focus(), 50); }}
            title="Find & Replace (Ctrl+H)"
            style={{
              height: 36, padding: "0 14px",
              border: `1px solid ${showFR ? "var(--accent-border)" : "var(--border)"}`,
              background: showFR ? "var(--accent-subtle)" : "var(--bg-card)",
              color: showFR ? "var(--accent)" : "var(--text-secondary)",
              borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            ⌕ Find & Replace
          </button>
          <button
            onClick={onCancel}
            style={{
              height: 36, padding: "0 16px",
              border: "1px solid var(--border)", background: "var(--bg-card)",
              color: "var(--text-secondary)", borderRadius: 8, fontSize: 13,
              fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {t.editor.cancel}
          </button>
          <button
            onClick={handleSave}
            style={{
              height: 36, padding: "0 16px",
              border: "none", background: "var(--accent)",
              color: "white", borderRadius: 8, fontSize: 13,
              fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {t.editor.save}
          </button>
        </div>
      </div>

      {showFR && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 16px", marginBottom: 20,
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: 10,
        }}>
          <div style={{ position: "relative", flex: 1 }}>
            <input
              ref={findRef}
              value={findText}
              onChange={e => setFindText(e.target.value)}
              placeholder="Find…"
              style={{
                width: "100%", height: 32, padding: "0 10px",
                border: "1px solid var(--border)", borderRadius: 6,
                background: "var(--bg)", color: "var(--text-primary)",
                fontSize: 13, fontFamily: "inherit", outline: "none",
                boxSizing: "border-box",
              }}
              onFocus={e => (e.currentTarget.style.borderColor = "var(--accent-border)")}
              onBlur={e => (e.currentTarget.style.borderColor = "var(--border)")}
            />
          </div>
          <div style={{ flex: 1 }}>
            <input
              value={replaceText}
              onChange={e => setReplaceText(e.target.value)}
              placeholder="Replace with…"
              style={{
                width: "100%", height: 32, padding: "0 10px",
                border: "1px solid var(--border)", borderRadius: 6,
                background: "var(--bg)", color: "var(--text-primary)",
                fontSize: 13, fontFamily: "inherit", outline: "none",
                boxSizing: "border-box",
              }}
              onFocus={e => (e.currentTarget.style.borderColor = "var(--accent-border)")}
              onBlur={e => (e.currentTarget.style.borderColor = "var(--border)")}
              onKeyDown={e => { if (e.key === "Enter") replaceAll(); }}
            />
          </div>
          {findText && (
            <div style={{ fontSize: 12, color: matchCount > 0 ? "var(--accent)" : "var(--text-tertiary)", whiteSpace: "nowrap", minWidth: 70 }}>
              {matchCount} match{matchCount !== 1 ? "es" : ""}
            </div>
          )}
          <button
            onClick={replaceAll}
            disabled={!findText}
            style={{
              height: 32, padding: "0 14px",
              border: "none", background: findText ? "var(--accent)" : "var(--bg-hover)",
              color: findText ? "white" : "var(--text-tertiary)",
              borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: findText ? "pointer" : "default",
              fontFamily: "inherit", whiteSpace: "nowrap",
            }}
          >
            Replace all
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {blocks.map((block, i) => {
          const isMatch = !!findText && block.text.toLowerCase().includes(findText.toLowerCase());
          return (
          <div key={i} style={{
            display: "grid",
            gridTemplateColumns: "64px 1fr",
            gap: 12,
            padding: "12px 16px",
            background: isMatch ? "var(--accent-subtle)" : "var(--bg)",
            border: `1px solid ${isMatch ? "var(--accent-border)" : "var(--border)"}`,
            borderRadius: 8,
            alignItems: "start",
          }}>
            <div style={{ paddingTop: 2 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-tertiary)", fontFamily: "var(--font-geist-mono), monospace", marginBottom: 2 }}>
                #{block.index}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-geist-mono), monospace", lineHeight: 1.4 }}>
                {block.timecode.replace(" --> ", "\n→ ")}
              </div>
            </div>
            <textarea
              value={block.text}
              onChange={e => updateBlock(i, e.target.value)}
              rows={block.text.split("\n").length || 1}
              style={{
                width: "100%",
                border: "1px solid transparent",
                background: "transparent",
                color: "var(--text-primary)",
                fontSize: 13.5,
                lineHeight: 1.6,
                fontFamily: "inherit",
                resize: "vertical",
                outline: "none",
                padding: "2px 4px",
                borderRadius: 4,
                boxSizing: "border-box",
              }}
              onFocus={e => (e.currentTarget.style.borderColor = "var(--accent-border)")}
              onBlur={e => (e.currentTarget.style.borderColor = "transparent")}
            />
            <button
              onClick={() => splitBlock(i)}
              title="Split block"
              style={{
                gridColumn: "2", justifySelf: "end",
                marginTop: 4,
                padding: "2px 8px", fontSize: 10, fontWeight: 600,
                border: "1px solid var(--border-subtle)", borderRadius: 4,
                background: "transparent", color: "var(--text-tertiary)",
                cursor: "pointer", fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              ⌥ split
            </button>
          </div>
          );
        })}
      </div>
    </div>
  );
}
