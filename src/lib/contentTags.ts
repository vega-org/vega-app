/** Clean provider labels before measuring their chips. */
export const normalizeContentTags = (values: readonly unknown[]): string[] =>
  [...new Set(values.filter(value => value !== null && value !== undefined)
    .map(value => String(value).trim()).filter(Boolean))];
