export function extractIdFromLink(link: string): string {
  // link is like /moviesDetail/xyz or full URL
  if (!link) return "";
  const match = link.match(/\/moviesDetail\/([^/?#]+)/);
  if (match) return match[1];
  // try to parse as encoded JSON with detailPath
  try {
    const parsed = JSON.parse(link);
    if (parsed.detailPath) return parsed.detailPath;
  } catch {}
  return link.replace(/^.*\//, "");
}

export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}
