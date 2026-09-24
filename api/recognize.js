import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const MODEL = "gpt-5.6";

const MAX_IMAGE_BASE64_LENGTH = 3_000_000;
const MAX_REFERENCE_BASE64_LENGTH = 2_000_000;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 20;

const rateState =
    globalThis.__financeHandwritingRateState ??
    new Map();

globalThis.__financeHandwritingRateState =
    rateState;

const financialDocumentSchema = {
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

const MASTER_PROMPT = `
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

function parseBody(req) {
    if (
        typeof req.body === "string"
    ) {
        return JSON.parse(
            req.body
        );
    }

    return req.body ?? {};
}

function requestIP(req) {
    const forwarded =
        req.headers[
            "x-forwarded-for"
        ];

    if (
        typeof forwarded ===
        "string"
    ) {
        return forwarded
            .split(",")[0]
            .trim();
    }

    return (
        req.socket
            ?.remoteAddress ??
        "unknown"
    );
}

function isRateLimited(req) {
    const now =
        Date.now();

    const ip =
        requestIP(req);

    const existing =
        rateState.get(ip);

    if (
        !existing ||
        now - existing.startedAt >=
            RATE_WINDOW_MS
    ) {
        rateState.set(
            ip,
            {
                startedAt: now,
                count: 1
            }
        );

        return false;
    }

    existing.count += 1;

    return (
        existing.count >
        RATE_MAX_REQUESTS
    );
}

function validateImage(
    value,
    maximum
) {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= maximum
    );
}

function validateAmount(
    value
) {
    return (
        typeof value === "string" &&
        /^-?\d+(?:\.\d{1,2})?$/
            .test(value)
    );
}

function validateDocument(
    document
) {
    if (
        !document ||
        typeof document !==
            "object" ||
        typeof document.title !==
            "string" ||
        !Array.isArray(
            document.sections
        )
    ) {
        throw new Error(
            "Invalid financial document."
        );
    }

    for (
        const section of
            document.sections
    ) {
        if (
            typeof section.heading !==
                "string" ||
            !Array.isArray(
                section.groups
            )
        ) {
            throw new Error(
                "Invalid financial section."
            );
        }

        for (
            const group of
                section.groups
        ) {
            if (
                typeof group.name !==
                    "string" ||
                !Array.isArray(
                    group.items
                )
            ) {
                throw new Error(
                    "Invalid financial group."
                );
            }

            for (
                const item of
                    group.items
            ) {
                if (
                    typeof item.label !==
                        "string" ||
                    !validateAmount(
                        item.amount
                    )
                ) {
                    throw new Error(
                        "Invalid financial item."
                    );
                }
            }
        }
    }

    return document;
}

function normalizeText(
    value
) {
    return value
        .toLowerCase()
        .normalize("NFKD")
        .replace(
            /[^a-z0-9]+/g,
            ""
        );
}

function structureSignature(
    document
) {
    return JSON.stringify({
        title:
            normalizeText(
                document.title
            ),

        sections:
            document.sections.map(
                section => ({
                    heading:
                        normalizeText(
                            section.heading
                        ),

                    semanticKind:
                        section
                            .semanticKind,

                    groups:
                        section.groups.map(
                            group => ({
                                name:
                                    normalizeText(
                                        group.name
                                    ),

                                items:
                                    group.items.map(
                                        item => ({
                                            label:
                                                normalizeText(
                                                    item.label
                                                ),

                                            semanticKind:
                                                item
                                                    .semanticKind
                                        }))
                            })
                        )
                })
            )
    });
}

function itemPath(
    section,
    group,
    item
) {
    return [
        section.heading ||
            "(section)",
        group.name ||
            "(group)",
        item.label ||
            "(item)"
    ].join(" / ");
}

function mergeAlignedPasses(
    passes
) {
    const signatures =
        passes.map(
            structureSignature
        );

    if (
        !signatures.every(
            value =>
                value ===
                signatures[0]
        )
    ) {
        return {
            needsAdjudication:
                true,

            disagreements: [
                {
                    path:
                        "__document_structure__",

                    candidates:
                        passes.map(
                            (
                                _,
                                index
                            ) =>
                                `pass-${
                                    index + 1
                                }`
                        )
                }
            ]
        };
    }

    const merged =
        structuredClone(
            passes[0]
        );

    const disagreements = [];

    let needsAdjudication =
        false;

    for (
        let sectionIndex = 0;
        sectionIndex <
        merged.sections.length;
        sectionIndex += 1
    ) {
        const section =
            merged.sections[
                sectionIndex
            ];

        for (
            let groupIndex = 0;
            groupIndex <
            section.groups.length;
            groupIndex += 1
        ) {
            const group =
                section.groups[
                    groupIndex
                ];

            for (
                let itemIndex = 0;
                itemIndex <
                group.items.length;
                itemIndex += 1
            ) {
                const item =
                    group.items[
                        itemIndex
                    ];

                const values =
                    passes.map(
                        pass =>
                            pass
                                .sections[
                                    sectionIndex
                                ]
                                .groups[
                                    groupIndex
                                ]
                                .items[
                                    itemIndex
                                ]
                                .amount
                    );

                const counts =
                    new Map();

                for (
                    const value of
                        values
                ) {
                    counts.set(
                        value,
                        (
                            counts.get(
                                value
                            ) ?? 0
                        ) + 1
                    );
                }

                const ranked =
                    [
                        ...counts.entries()
                    ].sort(
                        (a, b) =>
                            b[1] -
                            a[1]
                    );

                const winner =
                    ranked[0];

                if (
                    winner[1] >= 2
                ) {
                    item.amount =
                        winner[0];
                } else {
                    needsAdjudication =
                        true;
                }

                if (
                    counts.size > 1
                ) {
                    disagreements.push({
                        path:
                            itemPath(
                                section,
                                group,
                                item
                            ),

                        candidates:
                            values
                    });
                }
            }
        }
    }

    return {
        needsAdjudication,
        document: merged,
        disagreements
    };
}

function buildImageContent(
    imageBase64,
    handwritingReferenceBase64
) {
    const content = [
        {
            type:
                "input_text",

            text:
                MASTER_PROMPT
        },
        {
            type:
                "input_image",

            image_url:
                `data:image/png;base64,${
                    imageBase64
                }`,

            detail:
                "original"
        }
    ];

    if (
        handwritingReferenceBase64
    ) {
        content.push(
            {
                type:
                    "input_text",

                text:
`The next image is a handwriting reference written by the SAME writer.

Use it ONLY to help disambiguate the writer's glyph shapes.
Do not extract financial information from the reference image.
Do not copy values from the reference image into the financial document.`
            },
            {
                type:
                    "input_image",

                image_url:
                    `data:image/png;base64,${
                        handwritingReferenceBase64
                    }`,

                detail:
                    "original"
            }
        );
    }

    return content;
}

async function independentRead({
    imageBase64,
    handwritingReferenceBase64,
    writerProfile,
    passNumber
}) {
    const content =
        buildImageContent(
            imageBase64,
            handwritingReferenceBase64
        );

    content.unshift({
        type:
            "input_text",

        text:
`Independent transcription pass ${passNumber} of 3.

Do not rely on or assume the result of any other pass.

Writer-specific notes, if any:
${writerProfile || "(none)"}
`
    });

    const response =
        await client.responses.create({
            model: MODEL,

            store: false,

            reasoning: {
                effort: "low"
            },

            input: [
                {
                    role: "user",
                    content
                }
            ],

            text: {
                format: {
                    type:
                        "json_schema",

                    name:
                        "financial_document",

                    strict:
                        true,

                    schema:
                        financialDocumentSchema
                }
            },

            max_output_tokens:
                2500
        });

    const parsed =
        JSON.parse(
            response.output_text
        );

    return validateDocument(
        parsed
    );
}

async function adjudicate({
    imageBase64,
    handwritingReferenceBase64,
    writerProfile,
    passes
}) {
    const content =
        buildImageContent(
            imageBase64,
            handwritingReferenceBase64
        );

    content.unshift({
        type:
            "input_text",

        text:
`Three independent readings of this same handwritten page disagreed.

Re-inspect the ORIGINAL PAGE IMAGE carefully.

Resolve the disagreements from the image itself.

Do not simply vote blindly.
Do not assume any one candidate is correct.

Preserve agreements that are clearly supported by the page,
but correct any candidate where the image shows something else.

Writer-specific notes, if any:
${writerProfile || "(none)"}

Candidate pass 1:
${JSON.stringify(
    passes[0]
)}

Candidate pass 2:
${JSON.stringify(
    passes[1]
)}

Candidate pass 3:
${JSON.stringify(
    passes[2]
)}
`
    });

    const response =
        await client.responses.create({
            model: MODEL,

            store: false,

            reasoning: {
                effort:
                    "medium"
            },

            input: [
                {
                    role: "user",
                    content
                }
            ],

            text: {
                format: {
                    type:
                        "json_schema",

                    name:
                        "financial_document_adjudication",

                    strict:
                        true,

                    schema:
                        financialDocumentSchema
                }
            },

            max_output_tokens:
                2500
        });

    const parsed =
        JSON.parse(
            response.output_text
        );

    return validateDocument(
        parsed
    );
}

export default async function handler(
    req,
    res
) {
    if (
        req.method === "GET"
    ) {
        return res
            .status(200)
            .json({
                ok: true,
                model: MODEL,
                mode:
                    "whole-page-consensus",
                passes: 3
            });
    }

    if (
        req.method !== "POST"
    ) {
        return res
            .status(405)
            .json({
                error:
                    "Method not allowed."
            });
    }

    if (
        isRateLimited(req)
    ) {
        return res
            .status(429)
            .json({
                error:
                    "Too many recognition requests. Please wait and try again."
            });
    }

    try {
        const body =
            parseBody(req);

        const {
            imageBase64,
            handwritingReferenceBase64 =
                null,
            writerProfile = ""
        } = body;

        if (
            !validateImage(
                imageBase64,
                MAX_IMAGE_BASE64_LENGTH
            )
        ) {
            return res
                .status(400)
                .json({
                    error:
                        "Missing or oversized page image."
                });
        }

        if (
            handwritingReferenceBase64 !==
                null &&
            !validateImage(
                handwritingReferenceBase64,
                MAX_REFERENCE_BASE64_LENGTH
            )
        ) {
            return res
                .status(400)
                .json({
                    error:
                        "Invalid handwriting reference image."
                });
        }

        if (
            typeof writerProfile !==
                "string" ||
            writerProfile.length >
                4000
        ) {
            return res
                .status(400)
                .json({
                    error:
                        "Invalid writer profile."
                });
        }

        const passes =
            await Promise.all([
                independentRead({
                    imageBase64,
                    handwritingReferenceBase64,
                    writerProfile,
                    passNumber: 1
                }),

                independentRead({
                    imageBase64,
                    handwritingReferenceBase64,
                    writerProfile,
                    passNumber: 2
                }),

                independentRead({
                    imageBase64,
                    handwritingReferenceBase64,
                    writerProfile,
                    passNumber: 3
                })
            ]);

        const merge =
            mergeAlignedPasses(
                passes
            );

        if (
            !merge
                .needsAdjudication
        ) {
            return res
                .status(200)
                .json({
                    document:
                        merge.document,

                    consensus: {
                        strategy:
                            merge
                                .disagreements
                                .length ===
                            0
                                ? "unanimous"
                                : "majority",

                        disagreements:
                            merge
                                .disagreements
                    }
                });
        }

        const document =
            await adjudicate({
                imageBase64,
                handwritingReferenceBase64,
                writerProfile,
                passes
            });

        return res
            .status(200)
            .json({
                document,

                consensus: {
                    strategy:
                        "adjudicated",

                    disagreements:
                        merge
                            .disagreements
                }
            });
    } catch (error) {
        console.error(error);

        return res
            .status(500)
            .json({
                error:
                    "Whole-page handwriting recognition failed."
            });
    }
}
