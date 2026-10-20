
/** The answer was cut off at the model's output limit (an API's finishReason length, a CLI saying so). */
export function outputCutOff(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /output token limit|exceeded the (?:maximum )?output|finishReason: length|max_?tokens|response was cut off/i.test(message);
}

