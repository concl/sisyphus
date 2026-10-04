import { describe, it, expect } from 'vitest'
import {
  insertStep,
  removeStep,
  orderedSteps,
  compatibleInput,
  type Flow,
  type Step,
} from '../../../plugins/contexts/frontend/action-model'

const node = (id: string): Step => ({ id, title: id, type: 'data.value', config: {}, x: 0, y: 0 })
const flow = (): Flow => ({
  id: 'flow',
  title: 'Test',
  color: 'blue',
  description: '',
  nodes: [node('a'), node('b')],
  edges: [
    { from: 'start', to: 'a' },
    { from: 'a', to: 'b' },
  ],
})

describe('workflow editing preserves dependency semantics', () => {
  it('inserts between the selected step and every successor', () => {
    const result = insertStep(flow(), node('new'), 'a')
    expect(result.edges).toEqual([
      { from: 'start', to: 'a' },
      { from: 'a', to: 'new' },
      { from: 'new', to: 'b' },
    ])
    expect(orderedSteps(result).map((node) => node.id)).toEqual(['a', 'new', 'b'])
  })
  it('can prepend after Start or branch without rewiring an existing path', () => {
    expect(orderedSteps(insertStep(flow(), node('first'), 'start')).map((node) => node.id)).toEqual(
      ['first', 'a', 'b'],
    )
    expect(insertStep(flow(), node('branch'), 'a', true).edges).toContainEqual({
      from: 'a',
      to: 'b',
    })
  })
  it('removes a middle step and preserves broken value references for explicit repair', () => {
    const original = flow()
    original.nodes[1].bindings = { value: { step: 'a', path: ['value'] } }
    const result = removeStep(original, 'a')
    expect(result.edges).toEqual([{ from: 'start', to: 'b' }])
    expect(result.nodes[0].bindings?.value).toEqual({ step: 'a', path: ['value'] })
    expect(original.nodes).toHaveLength(2)
  })
  it('repairs joins without introducing duplicate connections', () => {
    const original = flow()
    original.nodes.push(node('branch'), node('join'))
    original.edges.push(
      { from: 'a', to: 'branch' },
      { from: 'b', to: 'join' },
      { from: 'branch', to: 'join' },
      { from: 'a', to: 'join' },
    )
    const result = removeStep(original, 'b')
    expect(result.edges.filter((edge) => edge.from === 'a' && edge.to === 'join')).toHaveLength(1)
  })
  it('shows disconnected drafts and accepts identical output/control kinds', () => {
    const original = flow()
    original.edges = []
    expect(orderedSteps(original)).toHaveLength(2)
    expect(compatibleInput('folder', 'folder')).toBe(true)
    expect(compatibleInput('lines', 'targets')).toBe(false)
    expect(compatibleInput('number', 'text')).toBe(false)
  })
})
