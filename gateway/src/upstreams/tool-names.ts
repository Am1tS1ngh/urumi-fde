// Every exposed tool is named <slug>__<tool>. Slugs cannot contain "_", so the
// first "__" always marks the boundary and two servers can share a tool name.
export const SEPARATOR = '__';
export const SLUG_PATTERN = /^[a-z][a-z0-9]{1,19}$/;

// Keeps the combined name within the 64-character limit LLM function calling uses.
const EXPOSABLE_TOOL = /^[A-Za-z0-9_-]{1,40}$/;

export function exposedName(slug: string, tool: string): string {
  return `${slug}${SEPARATOR}${tool}`;
}

export function isExposable(tool: string): boolean {
  return EXPOSABLE_TOOL.test(tool);
}

export function parseExposedName(name: string): { slug: string; tool: string } | null {
  const index = name.indexOf(SEPARATOR);
  if (index < 0) return null;
  const slug = name.slice(0, index);
  const tool = name.slice(index + SEPARATOR.length);
  return SLUG_PATTERN.test(slug) && tool ? { slug, tool } : null;
}
