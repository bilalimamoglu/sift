import type { InsufficientHintInput } from "../../../src/core/insufficient.js";

export interface TrustInsufficientFixture {
  input: InsufficientHintInput;
}

const proseDocInput = "# README\n\n- Install with npm\n- Run sift exec first\n";

export const proseDocSuppressesTestStatusFixture: TrustInsufficientFixture = {
  input: {
    presetName: "lint-failures",
    originalLength: proseDocInput.length,
    truncatedApplied: false,
    recognizedRunner: "pytest",
    inputText: proseDocInput
  }
};
