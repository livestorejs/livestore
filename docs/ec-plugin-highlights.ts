import { InlineStyleAnnotation, definePlugin } from '@expressive-code/core'
import { codeToTokens, isSupportedLanguage } from '@pierre/highlights'
import { githubDark } from '@pierre/highlights/themes'

/** Highlight ordinary fences and Starlight Code. Twoslash owns a separate Shiki renderer. */
export const pluginHighlights = () =>
  definePlugin({
    name: 'highlights',
    hooks: {
      performSyntaxAnalysis: ({ codeBlock, styleVariants }) => {
        const lang = codeBlock.language
        // Highlights throws for unsupported languages; Expressive Code keeps these as plain text.
        if (!isSupportedLanguage(lang)) return
        const { tokens, fg } = codeToTokens(codeBlock.code, { lang, theme: githubDark })
        const lines = codeBlock.getLines()
        for (let styleVariantIndex = 0; styleVariantIndex < styleVariants.length; styleVariantIndex++) {
          tokens.forEach((tokens, lineIndex) => {
            let columnStart = 0
            for (const token of tokens) {
              const columnEnd = columnStart + token.content.length
              const fontStyle = token.fontStyle ?? 0
              if (columnEnd > columnStart) {
                lines[lineIndex]?.addAnnotation(
                  new InlineStyleAnnotation({
                    styleVariantIndex,
                    color: token.color ?? fg,
                    italic: Boolean(fontStyle & 1),
                    bold: Boolean(fontStyle & 2),
                    underline: Boolean(fontStyle & 4),
                    strikethrough: Boolean(fontStyle & 8),
                    inlineRange: { columnStart, columnEnd },
                    renderPhase: 'earliest',
                  }),
                )
              }
              columnStart = columnEnd
            }
          })
        }
      },
    },
  })
