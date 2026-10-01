import {
    canonicalAmount,
    validateDocument
} from "./contract.js";

export const normalizeText =
    value =>
        value
            .normalize("NFKD")
            .toLowerCase()
            .replace(
                /\p{M}/gu,
                ""
            )
            .replace(
                /[^\p{L}\p{N}]+/gu,
                " "
            )
            .trim()
            .replace(
                /\s+/g,
                " "
            );

function median(
    values
) {
    const sorted =
        [...values]
            .sort(
                (a, b) =>
                    a - b
            );

    return sorted[
        Math.floor(
            sorted.length / 2
        )
    ];
}

function medianRegion(
    regions
) {
    /*
     Only merge when all three independent reads
     actually returned a region.

     Otherwise leave the first document's region alone.
     */
    if (
        regions.length !== 3
    ) {
        return null;
    }

    return {
        x:
            median(
                regions.map(
                    region =>
                        region.x
                )
            ),

        y:
            median(
                regions.map(
                    region =>
                        region.y
                )
            ),

        width:
            median(
                regions.map(
                    region =>
                        region.width
                )
            ),

        height:
            median(
                regions.map(
                    region =>
                        region.height
                )
            )
    };
}

function index(
    document
) {
    const nodes =
        new Map();

    const items =
        new Map();

    let duplicate =
        false;

    const add =
        (
            key,
            value
        ) => {
            if (
                nodes.has(key)
            ) {
                duplicate = true;
            }

            nodes.set(
                key,
                value
            );
        };

    for (const category of document.categories) {
        const categoryKey = [normalizeText(category.name)];
        add(JSON.stringify(categoryKey), category);
        for (const field of category.fields) {
            const key = JSON.stringify([...categoryKey, normalizeText(field.label)]);
            add(key, field);
            items.set(key, {item: field, path: [category.name, field.label].join(" / ")});
        }
    }

    return {
        signature:
            JSON.stringify([
                normalizeText(
                    document.title
                ),
                [
                    ...nodes.keys()
                ].sort()
            ]),

        items,
        duplicate
    };
}

export function mergeAlignedPasses(
    passes
) {
    if (
        passes.length !== 3
    ) {
        throw new Error(
            "Exactly three independent passes are required."
        );
    }

    passes.forEach(
        validateDocument
    );

    const indices =
        passes.map(index);

    if (
        indices.some(
            value =>
                value.duplicate
                ||
                value.signature
                    !==
                    indices[0]
                        .signature
        )
    ) {
        return {
            needsAdjudication:
                true,

            disagreements: [
                {
                    path:
                        "__document_structure__",

                    candidates: [
                        "pass-1",
                        "pass-2",
                        "pass-3"
                    ]
                }
            ]
        };
    }

    const document =
        structuredClone(
            passes[0]
        );

    /*
     Regions are predictions too.

     When all three independent reads agree structurally,
     use the component-wise median rectangle so one
     unusually wide/narrow region does not control the
     automatic-template crop.
     */
    const titleRegions =
        passes
            .map(
                pass =>
                    pass.titleRegion
            )
            .filter(
                region =>
                    region != null
            );

    const mergedTitleRegion =
        medianRegion(
            titleRegions
        );

    if (
        mergedTitleRegion
    ) {
        document.titleRegion =
            mergedTitleRegion;
    }

    const mergedIndex =
        index(document);

    const disagreements = [];

    let needsAdjudication =
        false;

    for (
        const [
            key,
            {
                item,
                path
            }
        ] of mergedIndex.items
    ) {
        const sourceItems =
            indices.map(
                value =>
                    value.items
                        .get(key)
                        .item
            );

        const values =
            sourceItems.map(
                source =>
                    source.amount
            );

        const normalized =
            values.map(
                canonicalAmount
            );

        const majority =
            normalized.find(
                value =>
                    normalized.filter(
                        other =>
                            other
                                === value
                    ).length >= 2
            );

        if (
            majority ===
                undefined
        ) {
            needsAdjudication =
                true;
        } else {
            item.amount =
                values[
                    normalized.indexOf(
                        majority
                    )
                ];
        }

        if (
            new Set(
                normalized
            ).size > 1
        ) {
            disagreements.push({
                path,
                candidates:
                    values
            });
        }

        const amountRegions =
            sourceItems
                .map(
                    source =>
                        source.amountRegion
                )
                .filter(
                    region =>
                        region != null
                );

        const mergedAmountRegion =
            medianRegion(
                amountRegions
            );

        if (
            mergedAmountRegion
        ) {
            item.amountRegion =
                mergedAmountRegion;
        }
    }

    return {
        document,
        disagreements,
        needsAdjudication
    };
}
