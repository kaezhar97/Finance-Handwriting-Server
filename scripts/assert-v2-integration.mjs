import assert from "node:assert/strict";
import { validateDocument, canonicalAmount } from "../lib/contract.js";
export function assertV2Integration(data, expectedAmounts = ["8500", "3200", "2350", "420", "185", "1000", "127450"]) {
    assert.equal(data.provenance?.promptVersion, "whole-page-v2");
    assert.equal(data.provenance?.schemaVersion, "financial-document-v2");
    validateDocument(data.document);
    const items = data.document.sections.flatMap(section => section.groups.flatMap(group => group.items));
    assert.ok(data.document.title.trim(), "Golden fixture has a visible handwritten title");
    assert.ok(items.length, "Golden fixture has financial items");
    const actual = items.map(item => canonicalAmount(item.amount)).sort();
    assert.deepEqual(actual, expectedAmounts.map(canonicalAmount).sort(), "Golden financial values changed");
    return {items: items.length, titleRegion: data.document.titleRegion, amountRegions: items.map(item => item.amountRegion)};
}
