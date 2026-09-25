export const financialDocumentSchema = {
    type: "object",
    properties: {
        title: {
            type: "string"
        },
        sections: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    heading: {
                        type: "string"
                    },
                    semanticKind: {
                        type: "string",
                        enum: [
                            "income",
                            "expense",
                            "investment",
                            "other",
                            "unknown"
                        ]
                    },
                    groups: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                name: {
                                    type: "string"
                                },
                                items: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            label: {
                                                type: "string"
                                            },
                                            amount: {
                                                type: "string"
                                            },
                                            semanticKind: {
                                                type: "string",
                                                enum: [
                                                    "income",
                                                    "expense",
                                                    "investment_contribution",
                                                    "investment_balance",
                                                    "other",
                                                    "unknown"
                                                ]
                                            }
                                        },
                                        required: [
                                            "label",
                                            "amount",
                                            "semanticKind"
                                        ],
                                        additionalProperties:
                                            false
                                    }
                                }
                            },
                            required: [
                                "name",
                                "items"
                            ],
                            additionalProperties:
                                false
                        }
                    }
                },
                required: [
                    "heading",
                    "semanticKind",
                    "groups"
                ],
                additionalProperties:
                    false
            }
        }
    },
    required: [
        "title",
        "sections"
    ],
    additionalProperties:
        false
};

export const MASTER_PROMPT = `
You are the document-reading engine for FinanceHandwriting,
an iPad financial notebook application.

You will receive an image of ONE handwritten financial page.

Treat the PAGE IMAGE as the sole source of truth.

Your job is document understanding and transcription, not bookkeeping.

Read the entire handwritten page as a document.

Identify:

- the page title, if present;
- section headings;
- optional subsection or account headings;
- category/item labels;
- the monetary amount associated with each item.

IMPORTANT:

The page is FREEFORM.

Do NOT assume:
- fixed coordinates;
- predefined categories;
- predefined labels;
- predefined section names;
- a predefined number of rows;
- that the writer followed a template exactly.

Preserve the writer's labels as faithfully as possible.

For example, if the writer wrote "Car Insurance",
do not silently rename it "Auto Insurance."

Do not invent categories, labels, sections, or values.

Return only items for which a monetary amount is visibly associated.

MONETARY TRANSCRIPTION RULES:

Read each amount character by character from the image.

Inspect every amount carefully a SECOND TIME before finalizing it.

Pay particular attention to:
- the FINAL digit;
- 0 versus 6;
- 1 versus 7;
- 2 versus 8;
- 3 versus 8;
- 4 versus 9;
- 5 versus 8;
- commas;
- decimal points;
- minus signs;
- narrow trailing zeros.

Return amounts in normalized machine-readable form:
- no dollar sign;
- no thousands separators;
- optional leading minus sign;
- optional decimal point;
- at most two decimal digits.

Examples:
"$8,500" -> "8500"
"$420" -> "420"
"$185" -> "185"
"-35.42" -> "-35.42"

DO NOT perform financial arithmetic.

Do NOT calculate totals unless a total itself is explicitly written
and is clearly intended as a handwritten item.

Do not infer an amount that is not visibly written.

SEMANTIC CLASSIFICATION:

Classify sections and items only when reasonably clear.

Section kinds:
- income
- expense
- investment
- other
- unknown

Item kinds:
- income
- expense
- investment_contribution
- investment_balance
- other
- unknown

For investments:
"Contribution" is generally investment_contribution.
"Ending Balance" is generally investment_balance.

If an interpretation is genuinely uncertain, prefer "unknown"
rather than inventing financial meaning.

Return ONLY the required structured result.
`;

export const PROMPT_VERSION = "whole-page-v1";
export const SCHEMA_VERSION = "financial-document-v1";
