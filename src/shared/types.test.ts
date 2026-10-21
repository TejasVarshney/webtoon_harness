import { describe, expectTypeOf, it } from 'vitest'
import type {
  AgentEvent,
  AppEvent,
  AssistantMessage,
  Capability,
  ChatMessage,
  EndpointConfig,
  EndpointKind,
  LoopOutcome,
  ModelRegistryView,
  PanelPatch,
  Role,
  RoleAssignments,
  ToolMessage,
  UserMessage,
  VariationInput,
  VariationKind
} from '@shared/types'

// Compile-time contract checks: `npm run typecheck` is what fails when these drift.
describe('shared types', () => {
  it('pins the unions the later tasks rely on', () => {
    expectTypeOf<Role>().toEqualTypeOf<'agent' | 'panelChat' | 'vision' | 'image' | 'imageEdit'>()
    expectTypeOf<Capability>().toEqualTypeOf<'text' | 'vision' | 'image-gen' | 'image-edit'>()
    expectTypeOf<EndpointKind>().toEqualTypeOf<'anthropic' | 'openai' | 'gemini' | 'mock'>()
    expectTypeOf<LoopOutcome>().toEqualTypeOf<'end' | 'max_steps' | 'cancelled' | 'error' | 'refusal' | 'max_tokens'>()
    expectTypeOf<AssistantMessage['stopReason']>().toEqualTypeOf<'end' | 'tool_use' | 'max_tokens' | 'refusal'>()
    expectTypeOf<ChatMessage>().toEqualTypeOf<UserMessage | AssistantMessage | ToolMessage>()
    expectTypeOf<VariationInput['kind']>().toEqualTypeOf<Exclude<VariationKind, 'base'>>()
  })

  it('shapes the registry view and events', () => {
    expectTypeOf<ModelRegistryView['effectiveRoles']>().toEqualTypeOf<Record<Role, string | null>>()
    expectTypeOf<ModelRegistryView['endpoints'][number]>().toEqualTypeOf<EndpointConfig & { hasKey: boolean }>()
    expectTypeOf<ModelRegistryView['roles']>().toEqualTypeOf<RoleAssignments>()
    expectTypeOf<Extract<AppEvent, { type: 'agent.event' }>['event']>().toEqualTypeOf<AgentEvent>()
    expectTypeOf<Extract<AgentEvent, { kind: 'run-finished' }>['outcome']>().toEqualTypeOf<LoopOutcome>()
    expectTypeOf<Extract<AppEvent, { type: 'models.changed' }>>().toEqualTypeOf<{ type: 'models.changed' }>()
  })

  it('panel patches carry no episode placement', () => {
    expectTypeOf<PanelPatch>().not.toHaveProperty('episodeId')
    expectTypeOf<PanelPatch>().not.toHaveProperty('afterPanelId')
  })
})
