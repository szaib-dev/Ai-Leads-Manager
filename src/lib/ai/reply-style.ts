// Apply the same simple presentation to streamed text and restored history.
export const REPLY_STYLE =
  "Use short, natural paragraphs. Do not use em dashes, headings, nested lists, numbered outlines, bold labels, or a hierarchy of sections. Avoid a capability pitch and repeated offers to import. Ask only necessary questions. Preserve exact filenames and actual database outcomes.";
export function formatChatText(text: string) {
  return text
    .replace(/\s*\u2014\s*/g, ", ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1");
}
