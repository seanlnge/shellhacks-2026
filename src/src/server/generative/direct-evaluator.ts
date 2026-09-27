import type { Experimental_CompositionEvaluator } from "@json-render/core";

export function createDirectJevEvaluator(
  apiKey: string,
): Experimental_CompositionEvaluator {
  return async ({ state, questions, signal }) => {
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "jev-latest", state, questions }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok)
      throw new Error(`Jev evaluation unavailable (HTTP ${response.status})`);

    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== "object" ||
      !("answers" in result) ||
      !result.answers ||
      typeof result.answers !== "object"
    )
      throw new Error("Invalid Jev evaluation response");

    const returned = result.answers as Record<string, unknown>;
    const answers: Record<string, { choice: string; confidence?: number }> = {};
    for (const [name, question] of Object.entries(questions)) {
      const answer = returned[name];
      if (
        !answer ||
        typeof answer !== "object" ||
        !("type" in answer) ||
        answer.type !== "choice" ||
        !("choice" in answer) ||
        typeof answer.choice !== "string" ||
        !Object.hasOwn(question.criteria, answer.choice)
      )
        throw new Error("Jev returned an unoffered choice");
      const confidence = "confidence" in answer ? answer.confidence : undefined;
      if (
        confidence !== undefined &&
        (typeof confidence !== "number" ||
          !Number.isFinite(confidence) ||
          confidence < 0 ||
          confidence > 1)
      )
        throw new Error("Invalid Jev confidence");
      answers[name] =
        confidence === undefined
          ? { choice: answer.choice }
          : { choice: answer.choice, confidence };
    }
    const usage =
      "usage" in result &&
      result.usage &&
      typeof result.usage === "object" &&
      "input_tokens" in result.usage
        ? result.usage.input_tokens
        : undefined;
    return {
      answers,
      ...(typeof usage === "number" && Number.isSafeInteger(usage) && usage >= 0
        ? { usage: { inputTokens: usage } }
        : {}),
    };
  };
}
