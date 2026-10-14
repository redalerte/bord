import { atom, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Tableau } from '../types'
import {
  DECALAGE_MIN,
  VIDE,
  construireTableau,
  delaiAvant,
  formatHeure,
  nomLimite,
  resumeLigne,
  trierLimites,
} from './logic'

const tableau = atom({ plugin: 'bord', key: 'tableau' } as const, VIDE)

/** Dernier rafraîchissement lancé, et s'il y en a un déjà programmé. */
let dernier = 0
let enAttente = false
/** Vrai quand un tour de la conversation vient de finir : le prochain rafraîchissement l'écrit dans le chat. */
let ecrireAuTour = false
/** Comment s'est terminé le dernier tour de chaque sous-agent. */
const fins: Record<string, string> = {}

/** La ligne épinglée, assez courte pour tenir sous le champ de saisie : « Ctx 8% · 5h 63% ↻14:00 · Sem 46% ». */
function ligneCourte(t: Tableau): string {
  const parts: string[] = [`Ctx ${t.contexte?.pourcent === undefined ? '—' : `${t.contexte.pourcent}%`}`]
  for (const l of trierLimites(t.limites)) {
    const nom = l.kind === 'five_hour' ? '5h' : l.kind === 'seven_day' ? 'Sem' : nomLimite(l.kind)
    const fin = l.kind === 'five_hour' && l.finit ? ` ↻${formatHeure(Date.parse(l.finit), DECALAGE_MIN)}` : ''
    parts.push(`${nom} ${Math.round(l.pourcent)}%${fin}`)
  }
  const actifs = t.agents.filter(a => a.etat === 'cours' || a.etat === 'attente').length
  if (actifs > 0) parts.push(`${actifs} ag.`)
  return parts.join(' · ')
}

/** Les chiffres que le moteur donne déjà à un crochet (`session.measure`). */
type Mesure = Pick<SessionUsage, 'context' | 'rateLimits'>

async function rafraichir($: EngineInterface, fournie?: Mesure): Promise<void> {
  try {
    // Dans `session.measure`, redemander l'usage ferait rentrer le crochet dans lui-même :
    // il passe donc ce qu'il a reçu.
    const [maintenant, vus, usage] = await Promise.all([
      $.clock.now(),
      $.agent.list(),
      fournie ?? $.session.usage(),
    ])
    let neuf: Tableau = VIDE
    await update($, tableau, avant => {
      neuf = construireTableau(avant, vus, usage, maintenant, fins)
      return neuf
    })
    // Une ligne épinglée sous le champ de saisie…
    $.ui.status(ligneCourte(neuf))
    // …et, à la fin d'un tour de la conversation, une ligne dans le chat avec le détail.
    const detail = resumeLigne(neuf, DECALAGE_MIN, true)
    if (ecrireAuTour) {
      ecrireAuTour = false
      // Une note dans la conversation (le modèle ne la lit pas) : c'est ce que l'application affiche le mieux.
      try {
        await $.session.append({
          message: { type: 'system', content: [{ type: 'text', text: `Bord · ${detail}` }] },
        })
      } catch {
        $.ui.log(`Bord · ${detail}`)
      }
    }
  } catch (erreur) {
    // Un rafraîchissement raté ne gêne jamais le tour : le prochain réessaie. On le dit, sans le taire.
    const message = erreur instanceof Error ? erreur.message : String(erreur)
    try {
      $.ui.log(`Bord · erreur : ${message}`)
    } catch {
      // Rien de plus à faire.
    }
  }
}

/** Rafraîchit au plus une fois par seconde ; une demande trop proche est remise à la seconde. */
async function demander($: EngineInterface, fournie?: Mesure): Promise<void> {
  const t = await $.clock.now()
  const reste = delaiAvant(dernier, t)
  if (reste <= 0) {
    dernier = t
    await rafraichir($, fournie)
    return
  }
  if (enAttente) return
  enAttente = true
  $.clock.after(reste, () => {
    enAttente = false
    void demander($)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    void demander($)

    return next(e)
  })

  // Après chaque tour, celui de la conversation comme celui d'un sous-agent.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId) fins[e.agentId] = e.reason
    else ecrireAuTour = true
    const fait = await next(e)
    await demander($)

    return fait
  })

  // Quand une limite d'utilisation bouge d'un point.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await demander($, { context: e.context, rateLimits: e.rateLimits })
    }

    return next(e)
  })
}
