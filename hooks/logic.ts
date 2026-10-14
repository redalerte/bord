import type { AgentInfo, AgentStatus, SessionUsage } from 'claude-code'

import type { Etat, LigneAgent, Tableau } from '../types'

/** Pas plus d'un rafraîchissement par seconde. */
export const INTERVALLE_MIN_MS = 1000
/** Heure d'Alger : UTC+1 toute l'année (pas d'heure d'été). */
export const DECALAGE_MIN = 60
/** Nombre de lignes de sous-agents gardées en mémoire. */
export const MAX_LIGNES = 40

export type AgentVu = Pick<AgentInfo, 'id' | 'status' | 'name' | 'description' | 'type'>

const pad = (n: number): string => String(n).padStart(2, '0')

/** Le tableau avant la première mesure. */
export const VIDE: Tableau = { instant: 0, agents: [], contexte: null, limites: [] }

/** 1000000 → « 1 000 000 ». */
export function fmtNombre(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export function etatOf(status: AgentStatus): Etat {
  switch (status) {
    case 'running':
      return 'cours'
    case 'completed':
      return 'termine'
    case 'failed':
    case 'killed':
      return 'echoue'
    default:
      return 'attente'
  }
}

export function libelle(etat: Etat): string {
  switch (etat) {
    case 'cours':
      return 'en cours'
    case 'termine':
      return 'terminé'
    case 'echoue':
      return 'échoué'
    default:
      return 'en attente'
  }
}

export function formatDuree(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${pad(s % 60)} s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ${pad(m % 60)} min`
  return `${Math.floor(h / 24)} j ${pad(h % 24)} h`
}

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

/** Heure locale (décalage fixe) : `14:32`, ou `14:32:07` avec les secondes. */
export function formatHeure(ms: number, decalageMin: number, avecSecondes = false): string {
  const d = new Date(ms + decalageMin * 60000)
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  return avecSecondes ? `${hm}:${pad(d.getUTCSeconds())}` : hm
}

/** « 14:32 (dans 2 h 05 min) », avec le jour quand la remise à zéro est à plus de 20 h. */
export function formatReset(iso: string | undefined, maintenant: number, decalageMin: number): string {
  if (!iso) return 'heure inconnue'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 'heure inconnue'
  const reste = t - maintenant
  if (reste <= 0) return 'maintenant'
  const jour = reste > 20 * 3600000 ? `${JOURS[new Date(t + decalageMin * 60000).getUTCDay()]} ` : ''
  return `${jour}${formatHeure(t, decalageMin)} (dans ${formatDuree(reste)})`
}

export function jauge(pourcent: number, largeur: number): string {
  const p = Math.min(100, Math.max(0, Number.isFinite(pourcent) ? pourcent : 0))
  const plein = Math.round((p / 100) * largeur)
  return '█'.repeat(plein) + '░'.repeat(Math.max(0, largeur - plein))
}

/** Clé de thème pour la couleur d'une jauge. */
export function nuance(pourcent: number): 'success' | 'warning' | 'error' {
  if (pourcent >= 90) return 'error'
  if (pourcent >= 70) return 'warning'
  return 'success'
}

export function nomLimite(kind: string): string {
  switch (kind) {
    case 'five_hour':
      return '5 heures'
    case 'seven_day':
      return 'Semaine'
    case 'spend_limit':
      return 'Plafond de dépense'
    default:
      return kind
  }
}

const RANG_LIMITE = ['five_hour', 'seven_day']

export function trierLimites<T extends { kind: string }>(limites: T[]): T[] {
  const rang = (k: string): number => {
    const i = RANG_LIMITE.indexOf(k)
    return i === -1 ? RANG_LIMITE.length : i
  }
  return [...limites].sort((a, b) => rang(a.kind) - rang(b.kind))
}

/** Combien de ms attendre avant le prochain rafraîchissement ; 0 ou moins : maintenant. */
export function delaiAvant(dernier: number, maintenant: number, min = INTERVALLE_MIN_MS): number {
  return min - (maintenant - dernier)
}

const nomOf = (a: AgentVu): string => a.name || a.description || a.id

/**
 * Remet à jour les lignes avec la liste du moteur. Un agent que le moteur a retiré
 * de sa liste est fini : `echoue` si son dernier tour s'est mal terminé
 * (`fins[id]` vaut `error`, `refusal` ou `aborted`), sinon `termine`.
 */
export function fusionner(
  avant: LigneAgent[],
  vus: AgentVu[],
  maintenant: number,
  fins: Record<string, string> = {},
): LigneAgent[] {
  const anciens = new Map(avant.map(l => [l.id, l]))
  const ids = new Set<string>()
  const lignes: LigneAgent[] = []
  for (const a of vus) {
    ids.add(a.id)
    const etat = etatOf(a.status)
    const ancien = anciens.get(a.id)
    lignes.push({
      id: a.id,
      nom: nomOf(a),
      type: a.type,
      etat,
      depuis: ancien && ancien.etat === etat ? ancien.depuis : maintenant,
    })
  }
  for (const ancien of avant) {
    if (ids.has(ancien.id)) continue
    if (ancien.etat === 'termine' || ancien.etat === 'echoue') {
      lignes.push(ancien)
      continue
    }
    const mal = ['error', 'refusal', 'aborted'].includes(fins[ancien.id] ?? '')
    lignes.push({ ...ancien, etat: mal ? 'echoue' : 'termine', depuis: maintenant })
  }
  return lignes.slice(-MAX_LIGNES)
}

const RANG_ETAT: Record<Etat, number> = { cours: 0, attente: 1, echoue: 2, termine: 3 }

/** Les agents actifs d'abord, puis les finis du plus récent au plus ancien. */
export function ordonner(lignes: LigneAgent[]): LigneAgent[] {
  return [...lignes].sort((a, b) => {
    const r = RANG_ETAT[a.etat] - RANG_ETAT[b.etat]
    return r !== 0 ? r : b.depuis - a.depuis
  })
}

/** « remise à zéro 14:32 », avec le jour quand c'est à plus de 20 h ; vide si l'heure est inconnue. */
export function resetCourt(iso: string | undefined, maintenant: number, decalageMin: number): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  if (t <= maintenant) return 'remise à zéro maintenant'
  const jour = t - maintenant > 20 * 3600000 ? `${JOURS[new Date(t + decalageMin * 60000).getUTCDay()]} ` : ''
  return `remise à zéro ${jour}${formatHeure(t, decalageMin)}`
}

function libelleNombre(etat: Etat, n: number): string {
  const mot = libelle(etat)
  return n > 1 && (etat === 'termine' || etat === 'echoue') ? `${mot}s` : mot
}

const ORDRE_ETATS: Etat[] = ['cours', 'attente', 'echoue', 'termine']

/** Les sous-agents en une phrase : les comptes, ou, avec `detail`, chacun avec son état et sa durée. */
export function agentsTexte(t: Tableau, detail: boolean): string {
  const lignes = ordonner(t.agents)
  if (lignes.length === 0) return 'Sous-agents : aucun'
  if (!detail) {
    const parts = ORDRE_ETATS.flatMap(etat => {
      const n = lignes.filter(l => l.etat === etat).length
      return n > 0 ? [`${n} ${libelleNombre(etat, n)}`] : []
    })
    return `Sous-agents : ${parts.join(', ')}`
  }
  const vus = lignes.slice(0, 4).map(l => `${l.nom} (${libelle(l.etat)}, ${formatDuree(t.instant - l.depuis)})`)
  const reste = lignes.length - vus.length
  return `Sous-agents : ${vus.join(' ; ')}${reste > 0 ? ` ; +${reste} autres` : ''}`
}

/** Le tableau de bord en une ligne : contexte, limites, sous-agents. */
export function resumeLigne(t: Tableau, decalageMin: number, detail: boolean): string {
  const parts: string[] = []
  const pc = t.contexte?.pourcent
  parts.push(`Contexte : ${pc === undefined ? '—' : `${pc} %`}`)
  const limites = trierLimites(t.limites)
  if (limites.length === 0) parts.push('Limites : pas encore de mesure')
  for (const l of limites) {
    const r = resetCourt(l.finit, t.instant, decalageMin)
    parts.push(`${nomLimite(l.kind)} : ${Math.round(l.pourcent)} %${r ? ` (${r})` : ''}`)
  }
  parts.push(agentsTexte(t, detail))
  return parts.join(' · ')
}

/** Le document `bord/etat` de la page « Bord », tel qu'elle le lit. */
export function versPage(t: Tableau): {
  ctx: number | null
  h5: { pct: number | null; fin: string }
  sem: { pct: number | null; fin: string }
  maj: number
} {
  const limite = (kind: string) => {
    const l = t.limites.find(x => x.kind === kind)
    return { pct: l ? l.pourcent : null, fin: l?.finit ?? '' }
  }
  return {
    ctx: t.contexte?.pourcent ?? null,
    h5: limite('five_hour'),
    sem: limite('seven_day'),
    maj: t.instant,
  }
}

export function construireTableau(
  avant: Tableau | null,
  vus: AgentVu[],
  usage: Pick<SessionUsage, 'context' | 'rateLimits'>,
  maintenant: number,
  fins: Record<string, string> = {},
): Tableau {
  return {
    instant: maintenant,
    agents: fusionner(avant?.agents ?? [], vus, maintenant, fins),
    contexte: {
      fenetre: usage.context.window,
      tokens: usage.context.tokens,
      pourcent: usage.context.percent,
    },
    limites: usage.rateLimits.map(r => ({
      kind: r.kind,
      pourcent: r.percentUsed,
      finit: r.resetsAt,
    })),
  }
}
