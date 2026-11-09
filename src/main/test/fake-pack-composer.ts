import { encodeSolidPng } from '../models/providers/png'
import type { PackComposer, PackPlan } from '../domain/reference-pack'

export interface FakePackComposer extends PackComposer {
  /** Every `compose` call, in order. */
  calls: { plan: PackPlan; sheets: { mime: string; data: Buffer }[] }[]
  /** What each call returned, in order. */
  outputs: Buffer[]
  /** While set, `compose` rejects with it. */
  failWith: Error | null
}

/** A `PackComposer` double: a solid PNG of the plan's size (a new shade per call), recording what it was asked to draw. */
export function createFakePackComposer(): FakePackComposer {
  const fake: FakePackComposer = {
    calls: [],
    outputs: [],
    failWith: null,
    async compose(plan, sheets) {
      fake.calls.push({ plan, sheets })
      if (fake.failWith) throw fake.failWith
      const png = encodeSolidPng(plan.width, plan.height, [fake.calls.length % 250, 200, 200])
      fake.outputs.push(png)
      return png
    }
  }
  return fake
}
