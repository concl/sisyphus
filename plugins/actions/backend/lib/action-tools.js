'use strict'
// Agent tools that let the chat model create and edit saved automation cards.
// They build a card from a compact list of steps, so the model never has to
// write the card's JSON files or its node ids, positions, and connections.
const { z } = require('zod')
const { colors } = require('./automations.js')
const { checkProgram } = require('./workflow-engine.js')

const bindingSchema = z.union([
  z.string().min(1).max(80),
  z
    .object({
      input: z.string().min(1).max(80),
      path: z.array(z.string().min(1)).max(32).optional(),
    })
    .strict(),
  z
    .object({
      step: z.string().min(1).max(80),
      path: z.array(z.string().min(1)).max(32).optional(),
    })
    .strict(),
])

const stepSchema = z
  .object({
    action: z
      .string()
      .min(1)
      .max(120)
      .describe('Action type id from list_action_types, for example system.websites.'),
    id: z
      .string()
      .min(1)
      .max(80)
      .optional()
      .describe('Stable step id; later steps reference it. Defaults to step-1, step-2, …'),
    title: z.string().min(1).max(80).optional().describe('Defaults to the action name.'),
    config: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Literal settings, merged over the action defaults.'),
    bindings: z
      .record(z.string(), bindingSchema)
      .optional()
      .describe('Maps a setting key to a card input key or to an earlier step result.'),
    x: z.number().min(0).max(8000).optional(),
    y: z.number().min(0).max(8000).optional(),
  })
  .strict()

const cardInputSchema = z
  .object({
    key: z.string().min(1).max(80).describe('Name that step bindings refer to.'),
    label: z.string().min(1).max(80),
    kind: z.enum(['text', 'number', 'boolean', 'lines', 'json']),
    value: z
      .unknown()
      .optional()
      .describe('Default value. Omit for "" text, 0 number, false boolean, [] lines, null json.'),
    field: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Optional editor control, for example { kind: "folder" }.'),
    editor: z.string().min(1).max(120).optional(),
  })
  .strict()

const edgeSchema = z
  .object({ from: z.string().min(1).max(80), to: z.string().min(1).max(80) })
  .strict()

const createSchema = z
  .object({
    id: z.string().min(1).max(80).optional().describe('Optional card id.'),
    title: z.string().min(1).max(80).describe('Card title shown on the shortcut.'),
    description: z.string().max(240).optional(),
    color: z.enum(colors).optional(),
    inputs: z.array(cardInputSchema).max(32).optional(),
    steps: z.array(stepSchema).min(1).max(64),
    edges: z
      .array(edgeSchema)
      .max(256)
      .optional()
      .describe('Connections between step ids and "start". Omit for one ordered chain.'),
  })
  .strict()

const updateSchema = z
  .object({
    id: z.string().min(1).max(80),
    title: z.string().min(1).max(80).optional(),
    description: z.string().max(240).optional(),
    color: z.enum(colors).optional(),
    inputs: z.array(cardInputSchema).max(32).optional().describe('Replaces every card input.'),
    inputValues: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('New saved values keyed by an existing card input key.'),
    steps: z
      .array(stepSchema)
      .min(1)
      .max(64)
      .optional()
      .describe('Replaces every step. Keep step ids stable when other steps reference results.'),
    edges: z
      .array(edgeSchema)
      .max(256)
      .optional()
      .describe('Replaces connections. Without steps, reconnects the existing steps.'),
  })
  .strict()

const idSchema = z.object({ id: z.string().min(1).max(80) }).strict()

// A write tool answers with the saved card plus its readiness issues, so the
// model can tell whether the new action can run and correct what it cannot.
function withIssues(automations, save) {
  return (input) => {
    const saved = save(input)
    return { ...saved, issues: checkProgram(saved, automations.actions) }
  }
}

function automationTools({ automations, onChange = () => {} }) {
  const changed = (operation) => (input) => {
    const value = operation(input)
    onChange()
    return value
  }
  return [
    {
      name: 'list_actions',
      description: 'List saved automation cards and their steps.',
      access: 'read',
      inputSchema: z.object({}).strict(),
      execute: () => automations.list(),
    },
    {
      name: 'list_action_types',
      description:
        'List the action types usable as workflow steps, with their settings, defaults, outputs, and reference notes. Call this before creating or editing an action.',
      access: 'read',
      inputSchema: z
        .object({
          search: z
            .string()
            .min(1)
            .max(80)
            .optional()
            .describe('Only actions whose id, name, or description contain this text.'),
        })
        .strict(),
      execute: ({ search }) => {
        const list = automations.actions.list()
        if (!search) return list
        const needle = search.toLowerCase()
        return list.filter((action) =>
          `${action.type} ${action.name} ${action.description}`.toLowerCase().includes(needle),
        )
      },
    },
    {
      name: 'get_action',
      description:
        'Read one saved automation card, including step ids, settings, inputs, and connections. Call this before editing it.',
      access: 'read',
      inputSchema: idSchema,
      execute: ({ id }) => automations.get(id),
    },
    {
      name: 'create_action',
      description:
        'Create a saved automation card (a one-click workflow) from a title and an ordered list of steps. Call list_action_types first to choose actions. Steps run in order unless edges are given.',
      access: 'write',
      inputSchema: createSchema,
      execute: changed(withIssues(automations, (input) => automations.create(input))),
    },
    {
      name: 'update_action',
      description:
        'Edit a saved automation card: its title, description, color, card inputs, or steps and connections. Read it with get_action first. Use inputValues to change one saved value without rebuilding the flow.',
      access: 'write',
      inputSchema: updateSchema,
      execute: changed(withIssues(automations, (input) => automations.update(input))),
    },
    {
      name: 'delete_action',
      description: 'Delete a saved automation card by id. Stop it first if it is running.',
      access: 'write',
      inputSchema: idSchema,
      execute: changed(({ id }) => automations.delete(id)),
    },
    {
      name: 'run_action',
      description:
        'Start a saved automation card by id. It may open applications or run local scripts.',
      access: 'write',
      inputSchema: z
        .object({
          id: z.string().min(1).max(80),
          inputValues: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
      execute: ({ id, inputValues }) => automations.start(id, inputValues),
    },
  ]
}

module.exports = { automationTools, createSchema, updateSchema }
