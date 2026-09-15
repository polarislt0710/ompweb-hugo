"use client";

import { Children, cloneElement, isValidElement, useMemo, type ComponentProps, type MouseEvent, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { resolveLocalFileHref } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { normalizeDisplayMath, useMarkdownPlugins } from "../lib/markdown";
import { markdownCodeRenderer } from "./MarkdownCode";
import { ClickableImage } from "./ImageLightbox";
import { MediaAttachment, mediaKind } from "./MediaAttachment";

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  sessionId?: string | null;
  onOpenFile?: (filePath: string) => void;
  suppressImages?: boolean;
}

export function MarkdownBody({ children, className, isStreaming, cwd, sessionId, onOpenFile, suppressImages = false }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  const { remarkPlugins, rehypePlugins } = useMarkdownPlugins(normalizedMarkdown);

  // Rebuilt only when its captured props change, not on every render.
  const components = useMemo<Components>(() => {
    const imgComponent = ({ src, alt, ...imgProps }: ComponentProps<"img"> & { node?: unknown }) => {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete (imgProps as { node?: unknown }).node;
      if (suppressImages) return alt ?? null;
      const filePath = typeof src === "string" ? resolveLocalFileHref(src, cwd) : null;
      if (filePath && mediaKind(filePath) === "image") {
        return <MediaAttachment filePath={filePath} label={alt} sessionId={sessionId} />;
      }
      const imageSrc = filePath
        ? `/api/files/${encodeFilePathForApi(filePath)}${sessionId ? `?type=read&sessionId=${encodeURIComponent(sessionId)}` : "?type=read"}`
        : src;
      // Dynamic local paths are served directly by the file API.
      return <ClickableImage src={imageSrc} alt={alt ?? ""} loading="lazy" {...imgProps} />;
    };

    /**
     * Split link children into linked text and previewable images. Images may
     * sit directly or wrapped in formatting (`[**![img](x)**](url)`); a
     * <button> can never nest inside an <a>, so image content is extracted
     * while text (with its formatting) stays linked.
     */
    const isElementWithChildren = (value: unknown): value is ReactElement<{ children?: ReactNode }> => isValidElement(value);
    const partitionLinkContent = (node: ReactNode): { textParts: ReactNode[]; imageParts: ReactNode[] } => {
      const textParts: ReactNode[] = [];
      const imageParts: ReactNode[] = [];
      for (const child of Children.toArray(node)) {
        if (!isElementWithChildren(child)) {
          textParts.push(child);
          continue;
        }
        if (child.type === imgComponent) {
          imageParts.push(child);
          continue;
        }
        const sub = partitionLinkContent(child.props.children);
        if (sub.imageParts.length === 0) {
          textParts.push(child);
        } else if (sub.textParts.length === 0) {
          // Formatting wrapper containing only images moves to the previews.
          imageParts.push(child);
        } else {
          // Mixed wrapper: keep the wrapper with its text, extract the images.
          textParts.push(cloneElement(child, undefined, sub.textParts));
          imageParts.push(...sub.imageParts);
        }
      }
      return { textParts, imageParts };
    };
    /** True when any text part carries non-whitespace content. */
    const hasMeaningfulText = (parts: ReactNode[]): boolean =>
      parts.some((part) => {
        if (typeof part === "string") return part.trim().length > 0;
        if (typeof part === "number") return true;
        if (isElementWithChildren(part)) return hasMeaningfulText(Children.toArray(part.props.children));
        return false;
      });

    const hrefRendersMedia = (href: unknown): boolean => {
      if (typeof href !== "string") return false;
      const filePath = resolveLocalFileHref(href, cwd);
      return Boolean(filePath && mediaKind(filePath));
    };
    const srcRendersMedia = (src: unknown): boolean => {
      if (typeof src !== "string") return false;
      const filePath = resolveLocalFileHref(src, cwd);
      return mediaKind(filePath ?? "") === "image";
    };
    // react-markdown gives <p> the custom <a>/<img> elements, not the
    // MediaAttachment those renderers return. Inspect href/src so a media
    // preview never hydrates as <p><div>.
    const isBlockMarkdownChild = (child: ReactNode): boolean => {
      if (!isValidElement(child)) return false;
      if (child.type === MediaAttachment) return true;
      const childProps = child.props as { href?: unknown; src?: unknown; children?: ReactNode };
      if (hrefRendersMedia(childProps.href) || srcRendersMedia(childProps.src)) return true;
      if (typeof child.type === "string") {
        return child.type === "div"
          || child.type === "pre"
          || child.type === "table"
          || child.type === "ul"
          || child.type === "ol"
          || child.type === "blockquote"
          || child.type === "section"
          || child.type === "figure"
          || child.type === "video"
          || child.type === "audio";
      }
      return Children.toArray(childProps.children).some(isBlockMarkdownChild);
    };

    return {
    code: markdownCodeRenderer({ isStreaming, inlineClassName: "markdown-inline-code" }),
    pre({ children }) {
      return <>{children}</>;
    },
    // MediaAttachment is a block <div>. react-markdown wraps links/images in
    // <p>, and <p><div> is invalid HTML — it hydrates as a mismatch overlay.
    p({ children, ...props }) {
      delete props.node;
      const block = Children.toArray(children).some(isBlockMarkdownChild);
      const Tag = block ? "div" : "p";
      return (
        <Tag {...props} className={block ? "markdown-block-p" : undefined}>
          {children}
        </Tag>
      );
    },
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      const { textParts, imageParts } = partitionLinkContent(children);
      // A <button> cannot nest inside an <a>. Pure image links (direct or
      // wrapped in formatting, possibly with surrounding whitespace) render
      // only the previews — the lightbox supersedes the link. Mixed links
      // keep their text linked and render image previews beside the anchor.
      if (imageParts.length > 0 && !hasMeaningfulText(textParts)) {
        return <>{children}</>;
      }
      const filePath = resolveLocalFileHref(href, cwd);
      const kind = filePath ? mediaKind(filePath) : null;
      if (filePath && kind) {
        const label = hasMeaningfulText(textParts) ? String(textParts.map((part) => typeof part === "string" ? part : "").join("")).trim() : undefined;
        return (
          <>
            <MediaAttachment filePath={filePath} label={label || undefined} sessionId={sessionId} />
            {imageParts}
          </>
        );
      }
      const openFile = onOpenFile;
      if (filePath && openFile) {
        const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
          if (event.defaultPrevented || event.button !== 0) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          const target = event.currentTarget.getAttribute("target");
          if (target && target !== "_self") return;
          event.preventDefault();
          openFile(filePath);
        };
        const anchor = <a href={href} {...props} onClick={handleClick}>{textParts}</a>;
        return imageParts.length > 0 ? <>{anchor}{imageParts}</> : anchor;
      }

      const anchor = (
        <a href={href} {...props} target="_blank" rel="noopener noreferrer">
          {textParts}
        </a>
      );
      return imageParts.length > 0 ? <>{anchor}{imageParts}</> : anchor;
    },
    img: imgComponent,
    table({ children }) {
      return (
        <div className="markdown-table-wrap">
          <table>{children}</table>
        </div>
      );
    },
    };
  }, [isStreaming, cwd, sessionId, onOpenFile, suppressImages]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
