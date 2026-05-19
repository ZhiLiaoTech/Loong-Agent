import { formatTime, shortId } from "../../shared/format.js";
import type { MemoryCandidate, MemoryReviewState } from "../types.js";
import styles from "./MemoryCandidatesPanel.module.css";

export function MemoryCandidatesPanel({
  candidates,
  review,
  result,
  loading,
  onRefresh,
  onPromote,
  onReject,
}: {
  candidates: readonly MemoryCandidate[];
  review: MemoryReviewState;
  result: string | null;
  loading: boolean;
  onRefresh: () => void;
  onPromote: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>Memory ({candidates.length})</h3>
        <button type="button" className={styles.refresh} onClick={onRefresh} disabled={loading}>
          Refresh
        </button>
      </div>
      {!candidates.length ? (
        <p className={styles.empty}>No pending memory candidates.</p>
      ) : (
        <ul className={styles.list}>
          {candidates.map(candidate => {
            const meta = [
              candidate.scope ?? "",
              candidate.sessionId ? `session ${shortId(candidate.sessionId)}` : "",
              candidate.createdAt ? formatTime(candidate.createdAt) : "",
            ].filter(Boolean).join(" / ");

            return (
              <li key={candidate.id} className={styles.item}>
                <strong className={styles.content}>{candidate.content || candidate.id}</strong>
                {meta ? <p className={styles.meta}>{meta}</p> : null}
                {candidate.reason ? <pre className={styles.reason}>{candidate.reason}</pre> : null}
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={!review.canPromote}
                    title={review.canPromote ? undefined : "Requires write permission"}
                    onClick={() => void onPromote(candidate.id)}
                  >
                    Promote
                  </button>
                  <button
                    type="button"
                    className={styles.danger}
                    disabled={!review.canReject}
                    title={review.canReject ? undefined : "Requires write permission"}
                    onClick={() => void onReject(candidate.id)}
                  >
                    Reject
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {result ? <pre className={styles.result}>{result}</pre> : null}
    </section>
  );
}
