import { canonicalAmount, validateDocument } from "./contract.js";
export const normalizeText = value => value.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g," ");
function index(document) {
    const nodes = new Map(), items = new Map();
    let duplicate = false;
    const add = (key, value) => { if (nodes.has(key)) duplicate = true; nodes.set(key,value); };
    for (const s of document.sections) {
        const sk = [normalizeText(s.heading),s.semanticKind]; add(JSON.stringify(sk), s);
        for (const g of s.groups) {
            const gk = [...sk,normalizeText(g.name)]; add(JSON.stringify(gk),g);
            for (const item of g.items) {
                const key = JSON.stringify([...gk,normalizeText(item.label),item.semanticKind]); add(key,item);
                items.set(key, { item, path: [s.heading || "(section)",g.name || "(group)",item.label || "(item)"].join(" / ") });
            }
        }
    }
    return { signature: JSON.stringify([normalizeText(document.title), [...nodes.keys()].sort()]), items, duplicate };
}
export function mergeAlignedPasses(passes) {
    if (passes.length !== 3) throw new Error("Exactly three independent passes are required.");
    passes.forEach(validateDocument);
    const indices = passes.map(index);
    if (indices.some(i => i.duplicate || i.signature !== indices[0].signature)) {
        return { needsAdjudication: true, disagreements: [{ path: "__document_structure__", candidates: ["pass-1","pass-2","pass-3"] }] };
    }
    const document = structuredClone(passes[0]), mergedIndex = index(document);
    const disagreements = []; let needsAdjudication = false;
    for (const [key, {item,path}] of mergedIndex.items) {
        const values = indices.map(i => i.items.get(key).item.amount);
        const normalized = values.map(canonicalAmount);
        const majority = normalized.find(v => normalized.filter(other => other === v).length >= 2);
        if (majority === undefined) needsAdjudication = true;
        else item.amount = values[normalized.indexOf(majority)];
        if (new Set(normalized).size > 1) disagreements.push({path,candidates:values});
    }
    return { document, disagreements, needsAdjudication };
}
