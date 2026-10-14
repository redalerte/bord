import { expect, test } from 'claude-code/testing'

import {
  agentsTexte,
  construireTableau,
  delaiAvant,
  etatOf,
  fmtNombre,
  formatDuree,
  formatHeure,
  formatReset,
  fusionner,
  jauge,
  nuance,
  ordonner,
  resetCourt,
  resumeLigne,
  trierLimites,
  versPage,
} from './logic'

test('les sept statuts du moteur tiennent dans les quatre états du tableau', () => {
  expect(etatOf('pending')).toBe('attente')
  expect(etatOf('waiting')).toBe('attente')
  expect(etatOf('idle')).toBe('attente')
  expect(etatOf('running')).toBe('cours')
  expect(etatOf('completed')).toBe('termine')
  expect(etatOf('failed')).toBe('echoue')
  expect(etatOf('killed')).toBe('echoue')
})

test('les durées se lisent en secondes, minutes, heures puis jours', () => {
  expect(formatDuree(0)).toBe('0 s')
  expect(formatDuree(59_999)).toBe('59 s')
  expect(formatDuree(125_000)).toBe('2 min 05 s')
  expect(formatDuree(3_725_000)).toBe('1 h 02 min')
  expect(formatDuree(2 * 86_400_000 + 3 * 3_600_000)).toBe('2 j 03 h')
  expect(formatDuree(-5)).toBe('0 s')
})

test('l\'heure d\'Alger est UTC+1', () => {
  const midi = Date.parse('2026-10-14T12:00:07Z')
  expect(formatHeure(midi, 60)).toBe('13:00')
  expect(formatHeure(midi, 60, true)).toBe('13:00:07')
})

test('la remise à zéro donne l\'heure et le temps restant', () => {
  const maintenant = Date.parse('2026-10-14T08:30:00Z')
  expect(formatReset('2026-10-14T11:00:00Z', maintenant, 60)).toBe('12:00 (dans 2 h 30 min)')
  expect(formatReset('2026-10-16T08:30:00Z', maintenant, 60)).toBe('ven. 09:30 (dans 2 j 00 h)')
  expect(formatReset('2026-10-14T08:00:00Z', maintenant, 60)).toBe('maintenant')
  expect(formatReset(undefined, maintenant, 60)).toBe('heure inconnue')
  expect(formatReset('pas une date', maintenant, 60)).toBe('heure inconnue')
})

test('la jauge reste dans ses bornes', () => {
  expect(jauge(0, 10)).toBe('░░░░░░░░░░')
  expect(jauge(50, 10)).toBe('█████░░░░░')
  expect(jauge(100, 10)).toBe('██████████')
  expect(jauge(250, 10)).toBe('██████████')
  expect(jauge(-3, 10)).toBe('░░░░░░░░░░')
  expect(jauge(Number.NaN, 4)).toBe('░░░░')
})

test('la couleur de la jauge suit le seuil', () => {
  expect(nuance(10)).toBe('success')
  expect(nuance(70)).toBe('warning')
  expect(nuance(90)).toBe('error')
})

test('les nombres se groupent par trois', () => {
  expect(fmtNombre(999)).toBe('999')
  expect(fmtNombre(48_200)).toBe('48 200')
  expect(fmtNombre(1_000_000)).toBe('1 000 000')
})

test('5 heures passe avant semaine, le reste après', () => {
  const tri = trierLimites([{ kind: 'spend_limit' }, { kind: 'seven_day' }, { kind: 'five_hour' }])
  expect(tri.map(l => l.kind)).toEqual(['five_hour', 'seven_day', 'spend_limit'])
})

test('au plus un rafraîchissement par seconde', () => {
  expect(delaiAvant(0, 5_000)).toBeLessThanOrEqual(0)
  expect(delaiAvant(10_000, 10_000)).toBe(1_000)
  expect(delaiAvant(10_000, 10_400)).toBe(600)
  expect(delaiAvant(10_000, 11_000)).toBe(0)
})

const vu = (id: string, status: Parameters<typeof etatOf>[0], name?: string) => ({
  id,
  status,
  name,
  description: `tâche ${id}`,
  type: 'general-purpose',
})

test('une ligne garde son « depuis » tant que son état ne change pas', () => {
  const t0 = fusionner([], [vu('a', 'pending', 'recherche')], 1_000)
  expect(t0[0]).toMatchObject({ nom: 'recherche', etat: 'attente', depuis: 1_000 })

  const t1 = fusionner(t0, [vu('a', 'pending', 'recherche')], 5_000)
  expect(t1[0].depuis).toBe(1_000)

  const t2 = fusionner(t1, [vu('a', 'running', 'recherche')], 6_000)
  expect(t2[0]).toMatchObject({ etat: 'cours', depuis: 6_000 })
})

test('sans nom, la ligne prend la description de la tâche', () => {
  const lignes = fusionner([], [vu('b', 'running')], 0)
  expect(lignes[0].nom).toBe('tâche b')
})

test('un agent retiré de la liste est fini, échoué si son dernier tour a mal fini', () => {
  const avant = fusionner([], [vu('a', 'running'), vu('b', 'running'), vu('c', 'running')], 0)
  const apres = fusionner(avant, [], 9_000, { b: 'error', c: 'answer' })
  const etat = (id: string) => apres.find(l => l.id === id)?.etat
  expect(etat('a')).toBe('termine')
  expect(etat('b')).toBe('echoue')
  expect(etat('c')).toBe('termine')
  expect(apres.every(l => l.depuis === 9_000)).toBe(true)
})

test('une ligne déjà finie n\'est pas touchée quand le moteur l\'oublie', () => {
  const fini = fusionner([], [vu('a', 'completed')], 1_000)
  const apres = fusionner(fini, [], 9_000)
  expect(apres[0]).toMatchObject({ etat: 'termine', depuis: 1_000 })
})

test('les agents actifs passent devant les finis', () => {
  const lignes = ordonner([
    { id: '1', nom: 'a', type: 't', etat: 'termine', depuis: 5 },
    { id: '2', nom: 'b', type: 't', etat: 'cours', depuis: 1 },
    { id: '3', nom: 'c', type: 't', etat: 'termine', depuis: 9 },
    { id: '4', nom: 'd', type: 't', etat: 'attente', depuis: 2 },
  ])
  expect(lignes.map(l => l.id)).toEqual(['2', '4', '3', '1'])
})

test('le tableau reprend le contexte et les limites du moteur', () => {
  const t = construireTableau(
    null,
    [],
    {
      context: { window: 200_000, tokens: 50_000, percent: 25 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 12.5, resetsAt: '2026-10-14T13:00:00Z' }],
    },
    42,
  )
  expect(t.instant).toBe(42)
  expect(t.contexte).toEqual({ fenetre: 200_000, tokens: 50_000, pourcent: 25 })
  expect(t.limites).toEqual([{ kind: 'five_hour', pourcent: 12.5, finit: '2026-10-14T13:00:00Z' }])
})

const T0 = Date.parse('2026-10-14T08:30:00Z')

test('la remise à zéro courte donne l\'heure d\'Alger, et le jour si c\'est loin', () => {
  expect(resetCourt('2026-10-14T11:00:00Z', T0, 60)).toBe('remise à zéro 12:00')
  expect(resetCourt('2026-10-16T08:30:00Z', T0, 60)).toBe('remise à zéro ven. 09:30')
  expect(resetCourt('2026-10-14T08:00:00Z', T0, 60)).toBe('remise à zéro maintenant')
  expect(resetCourt(undefined, T0, 60)).toBe('')
})

test('les sous-agents se résument par état, avec le pluriel', () => {
  const ligne = (id: string, etat: 'cours' | 'attente' | 'termine' | 'echoue', depuis: number) => ({
    id,
    nom: `agent ${id}`,
    type: 't',
    etat,
    depuis,
  })
  const t = {
    instant: T0,
    contexte: null,
    limites: [],
    agents: [ligne('a', 'termine', 1), ligne('b', 'termine', 2), ligne('c', 'cours', T0 - 125_000)],
  }
  expect(agentsTexte(t, false)).toBe('Sous-agents : 1 en cours, 2 terminés')
  expect(agentsTexte(t, true)).toBe(
    `Sous-agents : agent c (en cours, 2 min 05 s) ; agent b (terminé, ${formatDuree(T0 - 2)}) ; agent a (terminé, ${formatDuree(T0 - 1)})`,
  )
  expect(agentsTexte({ ...t, agents: [] }, false)).toBe('Sous-agents : aucun')
})

test('la ligne du bord réunit contexte, limites et sous-agents', () => {
  const t = {
    instant: T0,
    contexte: { fenetre: 200_000, tokens: 84_000, pourcent: 42 },
    limites: [
      { kind: 'seven_day', pourcent: 61, finit: '2026-10-16T08:30:00Z' },
      { kind: 'five_hour', pourcent: 23.4, finit: '2026-10-14T11:00:00Z' },
    ],
    agents: [],
  }
  expect(resumeLigne(t, 60, false)).toBe(
    'Contexte : 42 % · 5 heures : 23 % (remise à zéro 12:00) · Semaine : 61 % (remise à zéro ven. 09:30) · Sous-agents : aucun',
  )
})

test('avant la première mesure, la ligne le dit sans inventer de chiffre', () => {
  const t = { instant: T0, contexte: { fenetre: 200_000 }, limites: [], agents: [] }
  expect(resumeLigne(t, 60, false)).toBe(
    'Contexte : — · Limites : pas encore de mesure · Sous-agents : aucun',
  )
})

test('le document de la page reprend contexte, limites et heure de mesure', () => {
  const t = {
    instant: 123,
    contexte: { fenetre: 200_000, tokens: 68_000, pourcent: 34 },
    limites: [
      { kind: 'seven_day', pourcent: 41, finit: '2026-10-17T10:00:00Z' },
      { kind: 'five_hour', pourcent: 21, finit: '2026-10-14T13:00:00Z' },
    ],
    agents: [],
  }
  expect(versPage(t)).toEqual({
    ctx: 34,
    h5: { pct: 21, fin: '2026-10-14T13:00:00Z' },
    sem: { pct: 41, fin: '2026-10-17T10:00:00Z' },
    maj: 123,
  })
  expect(versPage({ instant: 5, contexte: null, limites: [], agents: [] })).toEqual({
    ctx: null,
    h5: { pct: null, fin: '' },
    sem: { pct: null, fin: '' },
    maj: 5,
  })
})
