import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { ComposerAttachment } from "./composerUtils.js";
import {
  formatAttachmentSize,
  useComposerAttachments,
  useComposerDragDrop,
  useComposerPaste,
  useFilePicker,
  useVoiceInput,
} from "./composerUtils.js";
import { useI18n } from "../../i18n/I18nContext.js";
import { ChatToolbarMenu } from "./ChatToolbarMenu.js";
import { ChatScopeSelector } from "./ChatScopeSelector.js";
import type { WorkspaceScopeSelection } from "@dashboard/app/run/workspaceScope.js";
import styles from "./ChatComposer.module.css";

export interface ChatComposerProps {
  disabled?: boolean;
  workspaceScope: WorkspaceScopeSelection;
  profileWorkspace?: string;
  onWorkspaceScopeChange: (selection: WorkspaceScopeSelection) => void;
  model: string;
  models: readonly string[];
  onModelChange: (model: string) => void;
  onSend: (message: string, attachments: ComposerAttachment[]) => void;
}

const ACCEPT =
  ".md,.txt,.json,.ts,.tsx,.py,.csv,.png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,image/*,text/*,application/pdf";

function attachmentIcon(kind: ComposerAttachment["kind"]): string {
  if (kind === "image") {
    return "🖼";
  }
  if (kind === "document") {
    return "📎";
  }
  return "📄";
}

export function ChatComposer({
  disabled = false,
  workspaceScope,
  profileWorkspace,
  onWorkspaceScopeChange,
  model,
  models,
  onModelChange,
  onSend,
}: ChatComposerProps) {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { attachments, error, addFiles, removeAt, clear } = useComposerAttachments();
  const { dragging, onDragOver, onDragLeave, onDrop } = useComposerDragDrop(disabled, addFiles);
  const onPaste = useComposerPaste(addFiles);
  const { inputRef, open, onChange } = useFilePicker(addFiles);
  const voice = useVoiceInput(text => {
    setMessage(current => (current.trim() ? `${current.trim()} ${text}` : text));
    textareaRef.current?.focus();
  });

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [message, resizeTextarea]);

  const hasContent = message.trim().length > 0 || attachments.length > 0;

  const submit = useCallback(() => {
    if (disabled || voice.recording) {
      return;
    }
    const value = message.trim();
    if (!value && attachments.length === 0) {
      return;
    }
    onSend(value, attachments);
    setMessage("");
    clear();
    voice.stop();
    requestAnimationFrame(resizeTextarea);
  }, [attachments, clear, disabled, message, onSend, resizeTextarea, voice]);

  const onSubmit = useCallback((event: FormEvent) => {
    event.preventDefault();
    submit();
  }, [submit]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }, [submit]);

  const rootClass = dragging ? `${styles.composer} ${styles.dragging}` : styles.composer;
  const modelAuto = model.trim() === "";
  const modelSelectTitle = modelAuto ? t("chat.modelAutoHint") : undefined;
  const modelMenuOptions = useMemo(
    () => [
      { value: "", label: t("chat.modelAuto"), hint: t("chat.modelAutoHint") },
      ...models.map(entry => ({ value: entry, label: entry })),
    ],
    [models, t],
  );

  return (
    <form
      className={rootClass}
      onSubmit={onSubmit}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {voice.recording ? (
        <div className={styles.recordingBar}>
          <span className={styles.wave} aria-hidden>
            <span />
            <span />
            <span />
            <span />
            <span />
          </span>
          {t("chat.recording")}
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className={styles.attachments}>
          {attachments.map((att, index) => (
            <span key={`${att.name}-${index}`} className={styles.chip} title={att.mimeType}>
              <span>{attachmentIcon(att.kind)}</span>
              <span className={styles.chipName}>{att.name}</span>
              <span>{formatAttachmentSize(att.size)}</span>
              <button
                type="button"
                className={styles.chipRemove}
                onClick={() => removeAt(index)}
                aria-label={`移除 ${att.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={message}
        onChange={event => setMessage(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={t("chat.inputPlaceholder")}
        rows={1}
        disabled={disabled || voice.recording}
      />

      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <ChatScopeSelector
            selection={workspaceScope}
            {...(profileWorkspace ? { profileWorkspace } : {})}
            disabled={disabled}
            onChange={onWorkspaceScopeChange}
          />

          <ChatToolbarMenu
            value={model}
            options={modelMenuOptions}
            onChange={onModelChange}
            disabled={disabled}
            ariaLabel={t("chat.modelSelect")}
            icon="◈"
            {...(modelSelectTitle ? { title: modelSelectTitle } : {})}
          />
        </div>

        <div className={styles.toolbarRight}>
          <button
            type="button"
            className={voice.recording ? `${styles.iconBtn} ${styles.iconBtnActive}` : styles.iconBtn}
            onClick={voice.toggle}
            disabled={disabled || !voice.supported}
            title={voice.supported ? t("chat.voiceInput") : t("chat.voiceUnsupported")}
            aria-label={t("chat.voiceInput")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z"
                stroke="currentColor"
                strokeWidth="1.75"
              />
              <path
                d="M19 11a7 7 0 0 1-14 0M12 18v3"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <button
            type="button"
            className={styles.iconBtn}
            onClick={open}
            disabled={disabled}
            title={t("chat.attach")}
            aria-label={t("chat.attach")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M16.5 6.5v8.75a4.75 4.75 0 0 1-9.5 0V7.25a3.25 3.25 0 0 1 6.5 0v8.5a2.25 2.25 0 0 1-4.5 0V8"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <button
            type="submit"
            className={styles.sendBtn}
            disabled={disabled || !hasContent || voice.recording}
          >
            {t("chat.send")}
          </button>
        </div>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      <input
        ref={inputRef}
        type="file"
        multiple
        className={styles.fileInput}
        onChange={onChange}
        accept={ACCEPT}
      />
    </form>
  );
}

export type { ComposerAttachment };
