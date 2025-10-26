import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai'
import {
  AiError,
  Config,
  Effect,
  FetchHttpClient,
  LanguageModel,
  Layer,
  Prompt,
  Schema,
  Tool,
} from '@livestore/utils/effect'

// Define the coach tool that analyzes LiveStore usage
export const coachTool = Tool.make('livestore_coach', {
  description:
    'Analyze LiveStore code (schemas, queries, mutations, etc.) and provide AI-powered feedback on best practices, performance, and improvements.',
  parameters: {
    code: Schema.String.annotations({
      description: 'The LiveStore code to analyze (TypeScript/JavaScript)',
    }),
    codeType: Schema.optional(
      Schema.String.annotations({
        description: "Type of code being analyzed: 'schema', 'query', 'mutation', 'component', or 'general'",
      }),
    ),
  },
  success: Schema.Struct({
    feedback: Schema.String.annotations({
      description: 'AI-generated feedback and recommendations for the code',
    }),
    score: Schema.optional(
      Schema.Number.annotations({
        description: 'Code quality score from 1-10 (optional)',
      }),
    ),
    suggestions: Schema.Array(
      Schema.String.annotations({
        description: 'Specific actionable suggestions for improvement',
      }),
    ).annotations({
      description: 'List of specific improvement suggestions',
    }),
  }),
  failure: AiError.AiError,
})

const OpenAiClientLayer = OpenAiClient.layerConfig({
  apiKey: Config.redacted('OPENAI_API_KEY'),
})

const OpenAiModel = OpenAiLanguageModel.layer({
  model: 'gpt-5-nano',
})

// Coach tool handler that uses OpenAI for analysis
export const coachToolHandler = Effect.fnUntraced(
  function* ({ code, codeType }) {
    // Build the analysis prompt
    const codeTypeContext = codeType ? `This is ${codeType} code using LiveStore. ` : 'This is LiveStore code. '

    const prompt = Prompt.makeMessage('user', {
      content: [
        Prompt.makePart('text', {
          text: `${codeTypeContext}Please review the following code and provide helpful feedback focusing on:

1. LiveStore best practices and conventions
2. Schema design and relationships (if applicable)
3. Query optimization and performance
4. Code structure and maintainability
5. Security considerations
6. Naming conventions
7. TypeScript usage and type safety

Code to review:
\`\`\`typescript
${code}
\`\`\`

Please provide:
1. Overall assessment and quality score (1-10)
2. Specific areas for improvement
3. Best practice recommendations
4. Any potential issues or concerns

Format your response as constructive feedback that helps developers improve their LiveStore usage.`,
        }),
      ],
    })

    const systemPrompt = Prompt.makeMessage('system', {
      content: `You are an expert LiveStore developer and code reviewer. Provide constructive, specific, and actionable feedback on LiveStore code. Focus on best practices, performance, and maintainability.`,
    })

    // Get OpenAI client and call the API
    const llm = yield* LanguageModel.LanguageModel
    const completion = yield* llm.generateText({ prompt: Prompt.fromMessages([systemPrompt, prompt]) })

    const feedback = completion.text ?? 'Unable to generate feedback'

    // Extract suggestions from the feedback (simple approach)
    const suggestions: string[] = feedback
      .split('\n')
      .filter(
        (line: string) =>
          line.trim().startsWith('-') ||
          line.trim().startsWith('*') ||
          line.trim().startsWith('•') ||
          line.toLowerCase().includes('recommend') ||
          line.toLowerCase().includes('consider') ||
          line.toLowerCase().includes('improve'),
      )
      .map((line: string) => line.replace(/^[-*•]\s*/, '').trim())
      .filter((suggestion: string) => suggestion.length > 10)
      .slice(0, 5) // Limit to 5 suggestions

    // Try to extract a score (simple regex approach)
    const scoreMatch = feedback.match(/(?:score|rating|quality).*?(\d+(?:\.\d+)?)/i)
    const score = scoreMatch ? Number.parseFloat(scoreMatch[1] ?? '0') : undefined

    return {
      feedback,
      score: score && score >= 1 && score <= 10 ? score : undefined,
      suggestions,
    }
  },
  Effect.provide(Layer.provideMerge(OpenAiModel, OpenAiClientLayer)),
  Effect.provide(FetchHttpClient.layer),
  Effect.catchTag('ConfigError', (e) => Effect.die(e)),
)
