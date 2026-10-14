import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Etat, Tableau } from '../types'
import {
  DECALAGE_MIN,
  VIDE,
  construireTableau,
  delaiAvant,
  fmtNombre,
  formatDuree,
  formatHeure,
  formatReset,
  jauge,
  libelle,
  nomLimite,
  nuance,
  ordonner,
  resumeLigne,
  trierLimites,
} from './logic'

const PANE = 'bord'
const tableau = atom({ plugin: 'bord', key: 'tableau' } as const, VIDE)

/** Dernier rafraîchissement lancé, et s'il y en a un déjà programmé. */
let dernier = 0
let enAttente = false
/** Vrai quand un tour de la conversation vient de finir : le prochain rafraîchissement l'écrit dans le chat. */
let ecrireAuTour = false
/** Comment s'est terminé le dernier tour de chaque sous-agent. */
const fins: Record<string, string> = {}

const PASTILLE: Record<Etat, string> = { cours: '●', attente: '○', termine: '✓', echoue: '✕' }
const COULEUR: Record<Etat, string> = {
  cours: 'suggestion',
  attente: 'inactive',
  termine: 'success',
  echoue: 'error',
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
    // Visible même sans panneau : une ligne épinglée sous le champ de saisie…
    $.ui.status(resumeLigne(neuf, DECALAGE_MIN, false))
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
    await $.command.register({
      name: 'bord',
      description: 'Rouvrir le tableau de bord : sous-agents, contexte, limites',
    })
    // Ouvert tout seul au démarrage ; /bord sert à le rouvrir après l'avoir fermé.
    void $.ui.open({ id: PANE, title: 'Tableau de bord' })
    void demander($)

    return next(e)
  })

  on('command.run', { command: 'bord' }, async $ => {
    const ouvert = await $.ui.open({ id: PANE, title: 'Tableau de bord' })
    await demander($)

    return {
      text: ouvert.isPlaced
        ? 'Tableau de bord ouvert.'
        : `Le tableau de bord n'a pas de place pour l'instant : ${ouvert.reason}`,
    }
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

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    // Le bureau peut nommer l'instance autrement : on reconnaît le panneau à son titre aussi.
    const { Box, Text } = $.ui.resolve(e)
    let t: Tableau
    try {
      t = await read($, tableau)
    } catch (erreur) {
      // Mieux vaut dire ce qui cloche dans le panneau que le laisser vide.
      const message = erreur instanceof Error ? erreur.message : String(erreur)
      return <Text>{`Bord · lecture impossible : ${message}`}</Text>
    }
    const colonnes = e.props.bodyColumns ?? 40
    const largeur = Math.max(10, Math.min(30, colonnes - 14))
    const agents = ordonner(t.agents)
    const limites = trierLimites(t.limites)
    const pc = t.contexte?.pourcent

    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>{`Bord 0.1.2 · ${e.surface} · ${String(e.requestId)} · ${e.props.title}`}</Text>
        <Box flexDirection="column">
          <Text weight="bold">Sous-agents</Text>
          {agents.length === 0 && <Text dimColor>Aucun sous-agent pour l'instant.</Text>}
          {agents.map(a => (
            <Box gap={1}>
              <Text color={COULEUR[a.etat]}>
                {PASTILLE[a.etat]} {libelle(a.etat).padEnd(10)}
              </Text>
              <Box flexShrink={1}>
                <Text wrap="truncate-end">{a.nom}</Text>
              </Box>
              <Text dimColor tabular>
                depuis {formatDuree(t.instant - a.depuis)}
              </Text>
            </Box>
          ))}
        </Box>

        <Box flexDirection="column">
          <Text weight="bold">Contexte</Text>
          {pc === undefined ? (
            <Text dimColor>Pas encore de mesure : elle arrive avec la première réponse.</Text>
          ) : (
            <Box flexDirection="column">
              <Box gap={1}>
                <Text color={nuance(pc)}>{jauge(pc, largeur)}</Text>
                <Text tabular>{pc} % utilisé</Text>
              </Box>
              {t.contexte?.tokens !== undefined && (
                <Text dimColor tabular>
                  {fmtNombre(t.contexte.tokens)} / {fmtNombre(t.contexte.fenetre)} tokens
                </Text>
              )}
            </Box>
          )}
        </Box>

        <Box flexDirection="column" gap={1}>
          <Text weight="bold">Limites d'utilisation</Text>
          {limites.length === 0 && (
            <Text dimColor>Aucune limite signalée pour l'instant (elle arrive avec la première réponse).</Text>
          )}
          {limites.map(l => (
            <Box flexDirection="column">
              <Box gap={1}>
                <Text>{nomLimite(l.kind)}</Text>
                <Text color={nuance(l.pourcent)}>{jauge(l.pourcent, largeur)}</Text>
                <Text tabular>{l.pourcent} %</Text>
              </Box>
              <Text dimColor>
                remise à zéro : {formatReset(l.finit, t.instant, DECALAGE_MIN)}
              </Text>
            </Box>
          ))}
        </Box>

        <Text dimColor>
          {t.instant === 0
            ? 'Aucune mesure pour l\'instant.'
            : `Mis à jour à ${formatHeure(t.instant, DECALAGE_MIN, true)} (heure d'Alger)`}
        </Text>
      </Box>
    )
  })
}
