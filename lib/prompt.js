const normalizedRegionSchema = {
    type: "object",
    properties: {
        x: {
            type: "number",
            minimum: 0,
            maximum: 1000
        },
        y: {
            type: "number",
            minimum: 0,
            maximum: 1000
        },
        width: {
            type: "number",
            minimum: 0,
            maximum: 1000
        },
        height: {
            type: "number",
            minimum: 0,
            maximum: 1000
        }
    },
    required: [
        "x",
        "y",
        "width",
        "height"
    ],
    additionalProperties: false
};

export const financialDocumentSchema = {
    type: "object",
    properties: {
        title: {
            type: "string"
        },
        titleRegion: normalizedRegionSchema,
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
                                            amountRegion:
                                                normalizedRegionSchema,
                                            semanticKind: {
                                                type: "string",
                                                enum: [
                                                    "income",
                                                    "expense",
                                                    "investment_contribution",
                                                    "investment_balance",
                                                    "asset_balance",
                                                    "liability_balance",
                                                    "other",
                                                    "unknown"
                                                ]
                                            }
                                        },
                                        required: [
                                            "label",
                                            "amount",
                                            "amountRegion",
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
        "titleRegion",
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

SOURCE REGIONS:

For the handwritten page title and for every monetary amount,
also return a tight bounding rectangle around the handwritten
glyphs that produced that value.

Coordinates are normalized against the COMPLETE input page image:

- x = 0 is the left edge;
- y = 0 is the top edge;
- 1000 is the right edge;
- 1000 is the bottom edge.

Return each rectangle as:

x
y
width
height

using values from 0 through 1000.

The rectangle must surround only the handwritten title or amount,
not the category label beside it.

Include a dollar sign, commas, decimal points, parentheses,
and minus signs when they visually belong to the monetary amount.

For example:

Mortgage     $2,350

The amountRegion should surround only "$2,350", not "Mortgage".

If there is no visible page title, return this zero rectangle:

{
  "x": 0,
  "y": 0,
  "width": 0,
  "height": 0
}

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

The page structure is freeform.

Do not require familiar category names.

For ordinary monthly cash-flow items, determine the economic direction:

- income:
  money received, earned, or otherwise added as income;

- expense:
  money spent, paid, consumed, or otherwise subtracted as an expense.

An unfamiliar heading does NOT mean the item should automatically
be classified as unknown.

For example:

DOG
Food 90
Vet 150

should normally contain expense items even though "DOG" is not a
predefined finance category.

Likewise:

SIDE WORK
Consulting 400

can be income when the page meaning clearly indicates money received.

A section clearly representing income or expenses provides useful
context for the items beneath it.

If an item's individual label is unusual but its section clearly
means income, classify that cash-flow item as income.

If an item's individual label is unusual but its section clearly
means expenses, classify that cash-flow item as expense.

Balances are different from cash flows.

Use:

- investment_contribution:
  money contributed to an investment account during the period;

- investment_balance:
  the balance or value of an investment account;

- asset_balance:
  the balance or value of a non-investment asset owned by the writer;

- liability_balance:
  a debt, loan, credit, mortgage, or other liability balance owed by
  the writer.

Do NOT classify an asset or liability BALANCE as monthly income
or expense merely because assets and liabilities ultimately affect
financial position.

Example:

Mortgage payment 2350

is normally an expense.

But:

Mortgage balance 285000

is normally a liability_balance.

Likewise:

Checking balance 12000

can be asset_balance rather than income.

Section kinds remain:

- income
- expense
- investment
- other
- unknown

Item kinds are:

- income
- expense
- investment_contribution
- investment_balance
- asset_balance
- liability_balance
- other
- unknown

Use "other" or "unknown" only when the visible page truly does not
provide enough context for a reasonable economic classification.

For investments:
"Contribution" is generally investment_contribution.
"Ending Balance" is generally investment_balance.

The image remains the source of truth.

Return ONLY the required structured result.
`;

export const PROMPT_VERSION =
    "whole-page-v2";

export const SCHEMA_VERSION =
    "financial-document-v2";
