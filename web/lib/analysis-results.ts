export type Difference = { delta: number; direction: "increase" | "decrease" | "similar" };
export type Comparison = Record<string, Difference | number> & { schema_version?: number };

function isDifference(value: Difference | number): value is Difference {
  return typeof value === "object"
    && value !== null
    && typeof value.delta === "number"
    && ["increase", "decrease", "similar"].includes(value.direction);
}

export function comparisonEntries(comparison: Comparison): [string, Difference][] {
  return Object.entries(comparison).filter((entry): entry is [string, Difference] => isDifference(entry[1]));
}
