import styles from "./Page.module.css";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <section className={styles.card}>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.lead}>{description}</p>
    </section>
  );
}
