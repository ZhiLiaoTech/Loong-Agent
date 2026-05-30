import type { OrgEmployeeFormState } from "../types.js";
import type { MemoryCandidateRow, SkillOption } from "../skillTypes.js";
import { useWorkbenchT } from "../../i18n/WorkbenchI18nContext.js";
import wb from "../../workbench.module.css";
import tierStyles from "../../models/components/TierConfigPanel.module.css";
import styles from "../OrganizationWorkspace.module.css";

interface CapabilityTabProps {
  form: OrgEmployeeFormState;
  skills: readonly SkillOption[];
  skillsAvailable: boolean;
  skillWarning?: string;
  memoryCandidates: readonly MemoryCandidateRow[];
  positionName?: string;
  saving: boolean;
  onChange: (patch: Partial<OrgEmployeeFormState>) => void;
  onApplyPositionPreset: () => void;
  onSave: () => void;
}

function toggleSkill(
  enabledSkills: readonly string[],
  skillName: string,
  checked: boolean,
): string[] {
  const set = new Set(enabledSkills);
  if (checked) {
    set.add(skillName);
  } else {
    set.delete(skillName);
  }
  return [...set];
}

export function CapabilityTab({
  form,
  skills,
  skillsAvailable,
  skillWarning,
  memoryCandidates,
  positionName,
  saving,
  onChange,
  onApplyPositionPreset,
  onSave,
}: CapabilityTabProps) {
  const t = useWorkbenchT();

  return (
    <div className={styles.formStack}>
      <section className={styles.sectionCard}>
        <div className={styles.sectionHeadRow}>
          <div>
            <h3 className={styles.sectionTitle}>{t("org.capability.roleTitle")}</h3>
            <p className={styles.sectionHint}>{t("org.capability.roleHint")}</p>
          </div>
          {positionName ? (
            <button
              type="button"
              className={wb.btnSecondary}
              onClick={onApplyPositionPreset}
              disabled={saving || !form.positionId}
            >
              {t("org.capability.applyPositionPreset").replace("{position}", positionName)}
            </button>
          ) : null}
        </div>
        <label className={wb.fieldFull}>
          <textarea
            className={wb.textarea}
            value={form.roleText}
            onChange={event => onChange({ roleText: event.target.value })}
            placeholder={t("org.capability.rolePlaceholder")}
            rows={8}
            aria-label={t("org.capability.roleTitle")}
          />
        </label>
      </section>

      <section className={styles.sectionCard}>
        <h3 className={styles.sectionTitle}>{t("org.capability.workflowTitle")}</h3>
        <p className={styles.sectionHint}>{t("org.capability.workflowHint")}</p>
        <label className={wb.fieldFull}>
          <textarea
            className={wb.textarea}
            value={form.workflowText}
            onChange={event => onChange({ workflowText: event.target.value })}
            placeholder={t("org.capability.workflowPlaceholder")}
            rows={6}
            aria-label={t("org.capability.workflowTitle")}
          />
        </label>
      </section>

      <section className={styles.sectionCard}>
        <h3 className={styles.sectionTitle}>{t("org.capability.skillsTitle")}</h3>
        <p className={styles.sectionHint}>{t("org.capability.skillsSectionHint")}</p>

        <div className={styles.skillList}>
          {!skillsAvailable && skillWarning ? (
            <p className={styles.skillsPlaceholder}>{skillWarning}</p>
          ) : null}
          {skills.length ? (
            skills.map(skill => (
              <div key={skill.name} className={styles.skillRow}>
                <div className={styles.skillCopy}>
                  <div className={styles.skillNameRow}>
                    <span className={styles.skillName}>{skill.name}</span>
                    {skill.preset ? (
                      <span className={styles.skillPresetBadge}>{t("org.capability.skillPreset")}</span>
                    ) : null}
                    {skill.category ? (
                      <span className={styles.skillCategory}>{skill.category}</span>
                    ) : null}
                  </div>
                  {skill.description ? (
                    <p className={styles.skillDescription}>{skill.description}</p>
                  ) : null}
                </div>
                <label className={tierStyles.switch}>
                  <input
                    type="checkbox"
                    checked={form.enabledSkills.includes(skill.name)}
                    onChange={event =>
                      onChange({
                        enabledSkills: toggleSkill(form.enabledSkills, skill.name, event.target.checked),
                      })
                    }
                    aria-label={skill.name}
                  />
                  <span className={tierStyles.switchTrack} aria-hidden />
                </label>
              </div>
            ))
          ) : (
            <p className={styles.skillsPlaceholder}>{t("org.capability.skillsEmpty")}</p>
          )}
        </div>
      </section>

      <section className={styles.sectionCard}>
        <h3 className={styles.sectionTitle}>{t("org.capability.contextTitle")}</h3>
        <p className={styles.sectionHint}>{t("org.capability.contextHint")}</p>
        <div className={styles.toolsSwitchRow}>
          <div className={styles.toolsSwitchCopy}>
            <p className={styles.toolsSwitchLabel}>{t("org.capability.aiSummarizationEnabled")}</p>
            <p className={styles.sectionHint}>{t("org.capability.aiSummarizationHint")}</p>
          </div>
          <label className={tierStyles.switch}>
            <input
              type="checkbox"
              checked={form.aiSummarizationEnabled}
              onChange={event => onChange({ aiSummarizationEnabled: event.target.checked })}
              aria-label={t("org.capability.aiSummarizationEnabled")}
            />
            <span className={tierStyles.switchTrack} aria-hidden />
          </label>
        </div>
      </section>

      <section className={styles.sectionCard}>
        <h3 className={styles.sectionTitle}>{t("org.capability.memoryTitle")}</h3>
        <p className={styles.sectionHint}>{t("org.capability.memoryHint")}</p>
        <div className={styles.toolsSwitchRow}>
          <div className={styles.toolsSwitchCopy}>
            <p className={styles.toolsSwitchLabel}>{t("org.capability.memoryEnabled")}</p>
          </div>
          <label className={tierStyles.switch}>
            <input
              type="checkbox"
              checked={form.memoryEnabled}
              onChange={event => onChange({ memoryEnabled: event.target.checked })}
              aria-label={t("org.capability.memoryEnabled")}
            />
            <span className={tierStyles.switchTrack} aria-hidden />
          </label>
        </div>
        <label className={wb.fieldFull}>
          <span>{t("org.capability.memoryDoc")}</span>
          <textarea
            className={wb.textarea}
            value={form.memoryText}
            onChange={event => onChange({ memoryText: event.target.value })}
            placeholder={t("org.capability.memoryPlaceholder")}
            rows={6}
            aria-label={t("org.capability.memoryDoc")}
          />
        </label>
        {memoryCandidates.length ? (
          <div>
            <p className={styles.sectionHint}>{t("org.capability.memoryCandidates")}</p>
            <ul className={styles.readOnlyList}>
              {memoryCandidates.map(candidate => (
                <li key={candidate.id}>
                  {candidate.content}
                  {candidate.status ? ` (${candidate.status})` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className={styles.skillsPlaceholder}>{t("org.capability.memoryCandidatesEmpty")}</p>
        )}
      </section>

      <div className={styles.footerActions}>
        <button
          type="button"
          className={wb.btnPrimary}
          onClick={onSave}
          disabled={saving || !form.displayName.trim()}
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}
