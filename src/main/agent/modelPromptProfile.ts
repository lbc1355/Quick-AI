import { ModelPromptProfile, ModelRuntimeConfig } from '../../shared/types'
import { inferModelPromptProfile } from '../../shared/providerProfiles'

const PROFILE_PROMPTS: Record<ModelPromptProfile, string> = {
  default: '',
  gpt: `Model profile (GPT/Codex):
- Prefer the smallest correct implementation that follows existing repository conventions.
- Continue through implementation and verification without stopping at a proposed plan unless the user asked only for analysis.
- Use brief progress updates for meaningful discoveries, decisions, or blockers; keep routine tool narration out of the final answer.`,
  claude: `Model profile (Claude):
- For genuinely multi-step work, keep an explicit task list synchronized with actual progress; skip it for simple requests.
- Investigate uncertain facts before agreeing with assumptions, and distinguish verified results from inference.
- Prefer specialized tools and parallelize independent reads or searches without duplicating delegated work.`,
  gemini: `Model profile (Gemini):
- Ground changes in repository context: inspect adjacent code, configuration, and tests before choosing an implementation.
- Keep tool calls scoped and verify the resulting behavior, not just that a command completed.
- Preserve the existing product language and design system unless the user explicitly requests a redesign.`,
  reasoning: `Model profile (reasoning model):
- Use internal reasoning to resolve ambiguity, but expose only concise conclusions, evidence, and actionable progress.
- Do not over-plan straightforward work; inspect, implement, and verify in the same run when safe.
- Treat tool output and repository state as the source of truth rather than relying on remembered implementation details.`
}

export function resolveModelPromptProfile(modelRuntime?: ModelRuntimeConfig): ModelPromptProfile {
  if (modelRuntime?.promptProfile) return modelRuntime.promptProfile
  return modelRuntime?.apiModel ? inferModelPromptProfile(modelRuntime.apiModel) : 'default'
}

export function buildModelPromptProfile(modelRuntime?: ModelRuntimeConfig): string {
  return PROFILE_PROMPTS[resolveModelPromptProfile(modelRuntime)]
}
