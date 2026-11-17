import { describe, expect, it } from 'vitest'
import { components } from '../../convex/_generated/api'
import { makeT } from './setup'

describe('migrations component wiring', () => {
  it('is registered in convex-test and reachable via components.migrations', async () => {
    const t = makeT()
    const status = await t.run((ctx) => ctx.runQuery(components.migrations.lib.getStatus, {}))
    expect(status).toEqual([])
  })
})
