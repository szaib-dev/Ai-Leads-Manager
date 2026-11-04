import test from "node:test";
import assert from "node:assert/strict";
import { formatChatText } from "../../src/lib/ai/reply-style";
test("assistant presentation removes em dashes, headings and bold labels", () => {
  assert.equal(
    formatChatText("### Assessment\n**Leads** — ready"),
    "Assessment\nLeads, ready",
  );
});
