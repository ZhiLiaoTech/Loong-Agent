import { useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import styles from "./Composer.module.css";

export interface ComposerAttachment {
  kind: "image" | "text" | "document";
  mimeType: string;
  data: string; // base64
  name: string;
  size: number;
}

export interface ComposerProps {
  disabled: boolean;
  onSend: (message: string, attachments: ComposerAttachment[]) => void;
}

const TEXT_EXTS = new Map<string, string>([
  [".md", "text/markdown"], [".markdown", "text/markdown"],
  [".txt", "text/plain"], [".log", "text/plain"],
  [".csv", "text/csv"], [".tsv", "text/csv"],
  [".html", "text/html"], [".htm", "text/html"],
  [".css", "text/css"], [".js", "text/javascript"], [".mjs", "text/javascript"],
  [".cjs", "text/javascript"], [".ts", "text/plain"], [".tsx", "text/plain"],
  [".jsx", "text/javascript"], [".py", "text/x-python"],
  [".json", "application/json"], [".jsonl", "application/json"],
  [".yaml", "application/yaml"], [".yml", "application/yaml"],
  [".xml", "application/xml"], [".rs", "text/plain"], [".go", "text/plain"],
  [".rb", "text/plain"], [".sh", "text/plain"], [".sql", "text/plain"],
]);
const IMAGE_EXTS = new Map<string, string>([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".webp", "image/webp"], [".gif", "image/gif"],
]);
const DOCUMENT_EXTS = new Map<string, string>([
  [".pdf", "application/pdf"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".doc", "application/msword"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".xls", "application/vnd.ms-excel"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".rtf", "application/rtf"],
]);
const MAX_ATTACHMENTS = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

async function fileToAttachment(file: File): Promise<ComposerAttachment | { error: string }> {
  if (file.size > MAX_FILE_BYTES) {
    return { error: `${file.name}: exceeds 10MB limit (${file.size} bytes)` };
  }
  const ext = extOf(file.name);
  const buf = await file.arrayBuffer();
  const data = bufferToBase64(buf);
  const imageMime = IMAGE_EXTS.get(ext) ?? (file.type.startsWith("image/") ? file.type : undefined);
  if (imageMime) {
    return { kind: "image", mimeType: imageMime, data, name: file.name, size: file.size };
  }
  const documentMime = DOCUMENT_EXTS.get(ext);
  if (documentMime) {
    return { kind: "document", mimeType: documentMime, data, name: file.name, size: file.size };
  }
  const textMime = TEXT_EXTS.get(ext) ?? (file.type.startsWith("text/") || file.type === "application/json" ? file.type : "text/plain");
  // Validate UTF-8 by trying to decode strictly
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return { error: `${file.name}: not a UTF-8 text file (and not a recognized image/pdf/docx/xlsx/pptx/rtf type)` };
  }
  return { kind: "text", mimeType: textMime, data, name: file.name, size: file.size };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function Composer({ disabled, onSend }: ComposerProps) {
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (attachments.length + list.length > MAX_ATTACHMENTS) {
      setError(`Too many attachments (max ${MAX_ATTACHMENTS}).`);
      return;
    }
    setError(null);
    const next: ComposerAttachment[] = [...attachments];
    for (const file of list) {
      const result = await fileToAttachment(file);
      if ("error" in result) {
        setError(result.error);
        continue;
      }
      next.push(result);
    }
    setAttachments(next);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (files && files.length > 0) {
      void addFiles(files);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(index: number) {
    setAttachments(attachments.filter((_, i) => i !== index));
  }

  function onDragOver(event: DragEvent<HTMLFormElement>) {
    if (disabled) return;
    if (event.dataTransfer?.types.includes("Files")) {
      event.preventDefault();
      setDragging(true);
    }
  }
  function onDragLeave(event: DragEvent<HTMLFormElement>) {
    if (event.currentTarget === event.target) setDragging(false);
  }
  function onDrop(event: DragEvent<HTMLFormElement>) {
    if (disabled) return;
    setDragging(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      event.preventDefault();
      void addFiles(files);
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      void addFiles(files);
    }
  }

  function submit() {
    const value = message.trim();
    if (disabled) return;
    if (!value && attachments.length === 0) return;
    onSend(value, attachments);
    setMessage("");
    setAttachments([]);
    setError(null);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  const hasContent = message.trim().length > 0 || attachments.length > 0;

  return (
    <form
      className={dragging ? `${styles.composer} ${styles.dragging}` : styles.composer}
      onSubmit={onSubmit}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <textarea
        className={styles.input}
        value={message}
        onChange={event => setMessage(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder="(drag .docx/.pdf/.xlsx/.png… here or paste an image)"
        rows={3}
        disabled={disabled}
      />
      {attachments.length > 0 ? (
        <div className={styles.attachments}>
          {attachments.map((att, index) => (
            <span key={`${att.name}-${index}`} className={styles.attachmentChip} title={`${att.mimeType} · ${formatBytes(att.size)}`}>
              <span className={styles.attachmentKind}>{att.kind === "image" ? "🖼" : att.kind === "document" ? "📕" : "📄"}</span>
              <span className={styles.attachmentName}>{att.name}</span>
              <span className={styles.attachmentSize}>{formatBytes(att.size)}</span>
              <button
                type="button"
                className={styles.attachmentRemove}
                onClick={() => removeAttachment(index)}
                aria-label={`Remove ${att.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {error ? <div className={styles.attachmentError}>{error}</div> : null}
      <div className={styles.actions}>
        <span className={styles.hint}>Enter to send · Shift+Enter for newline · paste image to attach</span>
        <div className={styles.actionButtons}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className={styles.fileInput}
            onChange={onFileChange}
            accept=".md,.markdown,.txt,.log,.csv,.tsv,.html,.htm,.css,.js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.json,.jsonl,.yaml,.yml,.xml,.rs,.go,.rb,.sh,.sql,.png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.rtf,image/*,text/*,application/json,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/rtf"
          />
          <button
            type="button"
            className={styles.attachBtn}
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
            title="Attach file"
            aria-label="Attach file"
          >
            <svg className={styles.attachIcon} viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M16.5 6.5v8.75a4.75 4.75 0 0 1-9.5 0V7.25a3.25 3.25 0 0 1 6.5 0v8.5a2.25 2.25 0 0 1-4.5 0V8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button type="submit" className={styles.sendBtn} disabled={disabled || !hasContent}>
            Send
          </button>
        </div>
      </div>
    </form>
  );
}
