import { ToolArgs, UserChoiceOption, UserChoiceResponse } from '../../shared/types'
import { globalUserChoiceManager } from '../agent/userChoiceManager'
import { ToolDefinition, ToolExecutionContext } from './types'

const MAX_USER_CHOICE_OPTIONS = 12

function cleanToolString(value: unknown, fallback = '', maxLength = 500): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return fallback
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

function parseUserChoiceOptions(value: unknown): UserChoiceOption[] {
  if (!Array.isArray(value)) return []

  const options: UserChoiceOption[] = []
  for (let i = 0; i < value.length && options.length < MAX_USER_CHOICE_OPTIONS; i++) {
    const item = value[i]
    if (typeof item === 'string') {
      const label = cleanToolString(item, '', 120)
      if (label) {
        options.push({ id: `option-${options.length + 1}`, label, value: label })
      }
      continue
    }

    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const label = cleanToolString(record.label ?? record.name ?? record.title, '', 120)
    if (!label) continue
    const rawValue = record.value ?? record.id ?? label
    const valueText =
      typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean'
        ? String(rawValue)
        : label
    const description = cleanToolString(record.description ?? record.detail ?? record.hint, '', 240)

    options.push({
      id: `option-${options.length + 1}`,
      label,
      value: valueText,
      ...(description ? { description } : {})
    })
  }

  return options
}

function formatUserChoiceResult(response: UserChoiceResponse, options: UserChoiceOption[]): string {
  if (response.cancelled) {
    return 'User cancelled the choice request.'
  }

  const selectedById = response.selectedOptionId
    ? options.find((option) => option.id === response.selectedOptionId)
    : undefined
  const selectedByValue = response.selectedValue
    ? options.find((option) => option.value === response.selectedValue)
    : undefined
  const selectedOption = selectedById || selectedByValue
  const label = response.customValue || response.selectedLabel || selectedOption?.label || ''
  const value = response.customValue || response.selectedValue || selectedOption?.value || label

  return [
    'User made a choice.',
    `Selected label: ${label || '(none)'}`,
    `Selected value: ${value || '(none)'}`
  ].join('\n')
}

export const askUserChoiceTool: ToolDefinition = {
  name: 'ask_user_choice',
  title: 'Ask User Choice',
  description:
    'Ask the user to choose one option from a short list. Use when you need an explicit preference or decision before continuing, such as selecting a database, framework, install target, or implementation direction. Do not use for simple yes/no execution permission.',
  tags: ['user', 'choice', 'select', 'ask', 'interactive', 'options', '选择', '选项'],
  category: 'system',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Optional short title for the choice dialog.'
      },
      question: {
        type: 'string',
        description: 'The question shown to the user.'
      },
      options: {
        type: 'array',
        description:
          'Choice options. Prefer objects with label, value, and optional description. String options are also accepted.',
        items: {
          anyOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: {
                label: { type: 'string' },
                value: { type: 'string' },
                description: { type: 'string' }
              }
            }
          ]
        }
      },
      allowCustom: {
        type: 'boolean',
        description: 'Whether the user may enter a custom answer instead of choosing an option.'
      },
      placeholder: {
        type: 'string',
        description: 'Placeholder text for the custom answer input when allowCustom is true.'
      },
      timeoutSeconds: {
        type: 'number',
        description: 'Optional timeout in seconds. Defaults to 600 seconds.'
      }
    },
    required: ['question', 'options']
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    if (!ctx.mainWindow || ctx.mainWindow.isDestroyed()) {
      throw new Error('Cannot ask the user because no application window is available.')
    }

    const question = cleanToolString(args.question, '', 500)
    if (!question) {
      throw new Error('Missing or invalid question parameter')
    }

    const options = parseUserChoiceOptions(args.options)
    if (options.length === 0) {
      throw new Error('ask_user_choice requires at least one valid option')
    }

    const requestId = `choice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const timeoutSeconds =
      typeof args.timeoutSeconds === 'number' && Number.isFinite(args.timeoutSeconds)
        ? Math.min(Math.max(args.timeoutSeconds, 5), 3600)
        : 600

    const choicePromise = globalUserChoiceManager.requestChoice(
      ctx.reqId,
      requestId,
      ctx.signal,
      timeoutSeconds * 1000
    )

    ctx.mainWindow.webContents.send('user-choice-request', {
      reqId: ctx.reqId,
      requestId,
      title: cleanToolString(args.title, '', 100),
      question,
      options,
      allowCustom: args.allowCustom === true,
      placeholder: cleanToolString(args.placeholder, '', 120)
    })

    const response = await choicePromise
    if (response.cancelled) {
      return {
        resultForModel:
          'User cancelled the choice request. Ask a clearer follow-up question or choose a safe default only if appropriate.',
        resultForUi: {
          title: '用户选择',
          summary: 'Cancelled'
        }
      }
    }

    const resultForModel = formatUserChoiceResult(response, options)
    const selectedLabel =
      response.customValue ||
      response.selectedLabel ||
      options.find((option) => option.id === response.selectedOptionId)?.label ||
      'Selection received'

    return {
      resultForModel,
      resultForUi: {
        title: '用户选择',
        summary: selectedLabel
      }
    }
  }
}
