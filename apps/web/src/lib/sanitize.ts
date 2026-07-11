const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "br",
  "div",
  "em",
  "i",
  "li",
  "ol",
  "p",
  "span",
  "strong",
  "u",
  "ul",
]);
const BLOCKED_CONTENT_TAGS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
];

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) {
    return "";
  }

  const withoutBlockedContent = BLOCKED_CONTENT_TAGS.reduce(
    (value, tag) =>
      value.replace(
        new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"),
        "",
      ),
    html,
  );
  const tagPattern = /<\/?([a-z][a-z0-9:-]*)([^>]*)>/gi;
  let output = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(withoutBlockedContent)) !== null) {
    output += escapeText(withoutBlockedContent.slice(lastIndex, match.index));
    output += sanitizeTag(match[0], match[1] ?? "", match[2] ?? "");
    lastIndex = tagPattern.lastIndex;
  }

  output += escapeText(withoutBlockedContent.slice(lastIndex));
  return output;
}

export function stripHtml(html: string | null | undefined): string {
  if (!html) {
    return "";
  }

  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeTag(rawTag: string, rawName: string, rawAttributes: string): string {
  const name = rawName.toLowerCase();

  if (!ALLOWED_TAGS.has(name)) {
    return "";
  }

  if (rawTag.startsWith("</")) {
    return name === "br" ? "" : `</${name}>`;
  }

  if (name === "br") {
    return "<br>";
  }

  if (name !== "a") {
    return `<${name}>`;
  }

  const href = extractHref(rawAttributes);

  if (!href) {
    return "<a>";
  }

  return `<a href="${escapeAttribute(href)}" target="_blank" rel="noreferrer">`;
}

function extractHref(attributes: string): string | null {
  const hrefMatch = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3];

  if (!href) {
    return null;
  }

  const decoded = decodeEntities(href.trim());

  if (/^(https?:|mailto:)/i.test(decoded)) {
    return decoded;
  }

  return null;
}

function escapeText(value: string): string {
  return value
    .replace(/&(?!(?:[a-z][a-z0-9]+|#\d+|#x[a-f0-9]+);)/gi, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(/&(#x[a-f0-9]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, code) => {
    const normalized = String(code).toLowerCase();

    if (normalized.startsWith("#x")) {
      return codePointToString(Number.parseInt(normalized.slice(2), 16), entity);
    }

    if (normalized.startsWith("#")) {
      return codePointToString(Number.parseInt(normalized.slice(1), 10), entity);
    }

    return named[normalized] ?? entity;
  });
}

function codePointToString(codePoint: number, fallback: string): string {
  if (!Number.isFinite(codePoint)) {
    return fallback;
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return fallback;
  }
}
