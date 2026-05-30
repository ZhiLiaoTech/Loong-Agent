import { theme } from "@loong/ui";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <section>
      <h1 style={{ color: theme.text }}>{title}</h1>
      <p style={{ color: theme.textSecondary }}>{description}</p>
    </section>
  );
}
