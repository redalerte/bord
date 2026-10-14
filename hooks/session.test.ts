import { expect, mock, test } from 'claude-code/testing'

test('à la fin d\'un tour, le mod note sa ligne dans la conversation et épingle son résumé', async ($, on) => {
  const epingles: Array<string | undefined> = []

  // Ce que le moteur répondrait sous le mod.
  mock.clock(on, { now: 5_000 })
  const session = mock.session(on)
  on('turn.complete', () => ({ text: 'ok' }))
  on('agent.list', () => ({ value: [] }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000, tokens: 84_000, percent: 42 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 23, resetsAt: '2099-01-01T00:00:00Z' }],
    },
  }))
  on('ui.status', (_$, e) => {
    epingles.push(e.text)
    return { value: undefined }
  })

  await $.turn.complete({
    answer: 'ok',
    durationMs: 10,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })

  const rows = session.appended()
  expect(rows).toHaveLength(1)
  expect(rows[0].message.type).toBe('system')
  expect(JSON.stringify(rows[0].message)).toContain('Bord · Contexte : 42 %')
  expect(epingles.some(s => s?.startsWith('Contexte : 42 %'))).toBe(true)
})
