export class ContextManager {
  constructor(private readonly repoRoot: string) {}

  async buildMastermindPrompt(
    userGoal: string,
    runId: string,
  ): Promise<string> {
    return `Decompose the following goal into 2-5 independent implementation sections.
Return a JSON array: [{ "id": string, "goal": string, "numWorkers": number, "dependsOn": string[] }]
Keep sections independent when possible. Use dependsOn only for true data dependencies.
Goal: ${userGoal}\nRun ID: ${runId}`;
  }

  buildPMPrompt(
    sectionId: string,
    sectionGoal: string,
    numWorkers: number,
    errorHistory: string[],
  ): string {
    return `You are a PM agent for the "${sectionId}" section.
Generate ${numWorkers} distinct implementation prompts for: ${sectionGoal}
If the section goal includes explicit file paths, export names, or output constraints, preserve those requirements exactly in every variant.
Return a JSON array of strings — each prompt must describe a different approach.
${errorHistory.length ? `\nPrior failures to avoid:\n${errorHistory.join("\n")}` : ""}`;
  }

  buildReviewerPrompt(
    sectionGoal: string,
    diffs: Array<{ workerId: string; diff: string }>,
  ): string {
    const details = diffs
      .map((d) => `### ${d.workerId}\n${d.diff || "(no diff)"}`)
      .join("\n\n");
    return `You are a code reviewer. Select the best implementation for: ${sectionGoal}
Return JSON: { "winnerId": string, "reasoning": string }
## Candidates\n${details}`;
  }
}
