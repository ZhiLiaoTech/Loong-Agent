import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";

export interface ComposerAttachment {
  kind: "image" | "text" | "document";
  mimeType: string;
  data: string;
  name: string;
  size: number;
}

const TEXT_EXTS = new Map<string, string>([
  [".md", "text/markdown"],
  [".txt", "text/plain"],
  [".json", "application/json"],
  [".ts", "text/plain"],
  [".tsx", "text/plain"],
  [".py", "text/x-python"],
  [".csv", "text/csv"],
]);
const IMAGE_EXTS = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);
const DOCUMENT_EXTS = new Map<string, string>([
  [".pdf", "application/pdf"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
]);

export const MAX_COMPOSER_ATTACHMENTS = 10;
export const MAX_COMPOSER_FILE_BYTES = 10 * 1024 * 1024;

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

export async function fileToComposerAttachment(
  file: File,
): Promise<ComposerAttachment | { error: string }> {
  if (file.size > MAX_COMPOSER_FILE_BYTES) {
    return { error: `${file.name} 超过 10MB 限制` };
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
  const textMime = TEXT_EXTS.get(ext) ?? "text/plain";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return { error: `${file.name} 不是支持的文本或文档格式` };
  }
  return { kind: "text", mimeType: textMime, data, name: file.name, size: file.size };
}

export function formatAttachmentSize(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function useComposerAttachments() {
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (attachments.length + list.length > MAX_COMPOSER_ATTACHMENTS) {
      setError(`最多 ${MAX_COMPOSER_ATTACHMENTS} 个附件`);
      return;
    }
    setError(null);
    const next = [...attachments];
    for (const file of list) {
      const result = await fileToComposerAttachment(file);
      if ("error" in result) {
        setError(result.error);
        continue;
      }
      next.push(result);
    }
    setAttachments(next);
  }, [attachments]);

  const removeAt = useCallback((index: number) => {
    setAttachments(current => current.filter((_, i) => i !== index));
  }, []);

  const clear = useCallback(() => {
    setAttachments([]);
    setError(null);
  }, []);

  return { attachments, error, setError, addFiles, removeAt, clear };
}

export function useComposerPaste(
  addFiles: (files: FileList | File[]) => Promise<void>,
) {
  return useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items) {
      return;
    }
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      void addFiles(files);
    }
  }, [addFiles]);
}

export function useComposerDragDrop(
  disabled: boolean,
  addFiles: (files: FileList | File[]) => Promise<void>,
) {
  const [dragging, setDragging] = useState(false);

  const onDragOver = useCallback((event: DragEvent) => {
    if (disabled) {
      return;
    }
    if (event.dataTransfer?.types.includes("Files")) {
      event.preventDefault();
      setDragging(true);
    }
  }, [disabled]);

  const onDragLeave = useCallback((event: DragEvent) => {
    if (event.currentTarget === event.target) {
      setDragging(false);
    }
  }, []);

  const onDrop = useCallback((event: DragEvent) => {
    if (disabled) {
      return;
    }
    setDragging(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      event.preventDefault();
      void addFiles(files);
    }
  }, [addFiles, disabled]);

  return { dragging, onDragOver, onDragLeave, onDrop };
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionEventLike {
  results: Iterable<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useVoiceInput(onTranscript: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(getSpeechRecognition() !== null);
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setRecording(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      onTranscript("");
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = event => {
      const parts: string[] = [];
      for (const result of event.results) {
        if (result.isFinal) {
          parts.push(result[0]?.transcript ?? "");
        }
      }
      const text = parts.join("").trim();
      if (text) {
        onTranscript(text);
      }
    };
    recognition.onerror = () => setRecording(false);
    recognition.onend = () => setRecording(false);
    recognitionRef.current = recognition;
    setRecording(true);
    recognition.start();
  }, [onTranscript]);

  const toggle = useCallback(() => {
    if (recording) {
      stop();
    } else {
      start();
    }
  }, [recording, start, stop]);

  return { recording, supported, toggle, stop };
}

export function useFilePicker(
  addFiles: (files: FileList | File[]) => Promise<void>,
) {
  const inputRef = useRef<HTMLInputElement>(null);

  const open = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      void addFiles(files);
    }
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, [addFiles]);

  return { inputRef, open, onChange };
}
