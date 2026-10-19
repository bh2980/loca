/**
 * The only sentences the server adds to an AI node's instructions: how to answer (the output form)
 * and how to read the input. Neutral about purpose; the node's instructions say what to do.
 * Dependency-free so the mock LLM (scripts/mock-llm-core.ts) can recognise the form they ask for.
 */

const PER_LINE = 'Answer as JSON: "results" has one entry per line id, each with';
export const FORMAT_TEXT = `${PER_LINE} "id" and "text".`;
export const FORMAT_VERDICT_HEAD = `${PER_LINE} "passed"`;
export const FORMAT_VERDICT = (categoryGuide: string) => `${FORMAT_VERDICT_HEAD}, "issues" (concrete problems, empty when passed) and "categories" (the kinds of those issues: ${categoryGuide}).`;
export const FORMAT_CHOICE = `${PER_LINE} "value" (exactly one of the options), "confidence" (0 to 1) and optionally a one-line "reason".`;
export const FORMAT_JSON_LINE = `${PER_LINE} "id" and the requested fields.`;
export const FORMAT_JSON_BATCH = 'Answer as one JSON object with the requested fields, for all the lines together.';

export const choiceOptionsSentence = (options: string[], allowNone: boolean) =>
  `Options for "value": ${options.map((option) => JSON.stringify(option)).join(', ')}.${allowNone ? ' Use null when none of them fits.' : ''}`;

/** How the lines of a whole-script request are written (batch mode "whole"). */
export const INPUT_SCRIPT =
  'The input is the script as text: "## <section> — <scene> [<scene key>]" headers; lines written "L<n> <Speaker>: <text>"; "[문서]" and "[UI]" are in-game documents and interface text; "▶ <label>" before a line means it follows that player choice or condition (lines after different choices are alternatives, never one conversation). Line ids are the "L<n>" numbers.';
