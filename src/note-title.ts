// Derives a short, human-readable title from a note's markdown content by
// taking the first non-empty block and stripping common markdown markers.

const MAX_TITLE_LENGTH = 80;

export function deriveTitle(content: string): string {
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const stripped = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s+/, "")
      .replace(/^[-*+]\s+\[[ xX]\]\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .trim();
    const text = stripped || line;
    return text.length > MAX_TITLE_LENGTH ? `${text.slice(0, MAX_TITLE_LENGTH - 1)}…` : text;
  }
  return "(empty)";
}
