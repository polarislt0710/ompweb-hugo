"use client";

import { useState, type MouseEvent } from "react";
import { Download } from "lucide-react";
import { ClickableImage } from "./ImageLightbox";
import { useI18n } from "@/lib/i18n";
import { encodeFilePathForApi, getFileName } from "@/lib/file-paths";
import { isAudioPath, isImagePath, isVideoPath } from "@/lib/file-types";

export function fileApiUrl(
  filePath: string,
  type: "read" | "download",
  sessionId?: string | null,
): string {
  const search = new URLSearchParams({ type });
  if (sessionId) search.set("sessionId", sessionId);
  return `/api/files/${encodeFilePathForApi(filePath)}?${search.toString()}`;
}

export function mediaKind(filePath: string): "image" | "audio" | "video" | null {
  if (isImagePath(filePath)) return "image";
  if (isVideoPath(filePath)) return "video";
  if (isAudioPath(filePath)) return "audio";
  return null;
}

export function MediaAttachment({
  filePath,
  label,
  sessionId,
}: {
  filePath: string;
  label?: string;
  sessionId?: string | null;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = mediaKind(filePath);
  const name = getFileName(filePath);
  const src = fileApiUrl(filePath, "read", sessionId);
  const downloadHref = fileApiUrl(filePath, "download", sessionId);
  const caption = label?.trim() && label.trim() !== name ? label.trim() : name;

  async function download(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(downloadHref, { credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(t("mediaAttachment.downloadFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gap: 8,
        margin: "10px 0",
        padding: "10px 12px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-control)",
        background: "var(--bg-panel)",
        maxWidth: 520,
        position: "relative",
        zIndex: 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={filePath}
        >
          {caption}
        </span>
        <button
          type="button"
          onClick={download}
          disabled={busy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
            padding: "4px 8px",
            border: 0,
            borderRadius: "var(--radius-control)",
            background: "var(--accent-strong)",
            color: "var(--on-accent)",
            fontSize: 11,
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          <Download size={13} strokeWidth={2.2} aria-hidden="true" />
          {busy ? t("mediaAttachment.downloading") : t("mediaAttachment.download")}
        </button>
      </div>
      {error && <p style={{ margin: 0, color: "var(--status-error)", fontSize: 11 }}>{error}</p>}
      {kind === "image" && (
        <ClickableImage
          src={src}
          alt={caption}
          loading="lazy"
          style={{ width: "100%", height: "auto", maxHeight: 420, objectFit: "contain", borderRadius: 8, background: "var(--bg)" }}
        />
      )}
      {kind === "audio" && (
        <audio controls preload="metadata" src={src} style={{ width: "100%" }}>
          {t("mediaAttachment.audioUnsupported")}
        </audio>
      )}
      {kind === "video" && (
        <video controls preload="metadata" src={src} style={{ width: "100%", maxHeight: 420, borderRadius: 8, background: "#000" }}>
          {t("mediaAttachment.videoUnsupported")}
        </video>
      )}
    </div>
  );
}
