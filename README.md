# Bord

Un mod pour Claude Code : un tableau de bord qui montre, en direct, ce qui se passe dans ta session.

## Ce qu'il montre

- **Sous-agents :** le nom de chacun, son état (en attente, en cours, terminé, échoué) et depuis combien de temps.
- **Contexte :** le pourcentage de la mémoire de la conversation déjà utilisé.
- **Limites d'utilisation :** le pourcentage utilisé sur 5 heures et sur la semaine, avec l'heure de remise à zéro (heure d'Alger, UTC+1).

Il se rafraîchit après chaque tour et quand une limite bouge d'un point, jamais plus d'une fois par seconde.

## Installer

Dans une session de terminal :

```
/plugin install bord --marketplace redalerte/bord
```

Depuis un shell :

```
claude plugin install bord --marketplace redalerte/bord
```

Le dépôt est privé : GitHub doit être connecté sur la machine où tu installes.

## Utiliser

- `/bord` ouvre le panneau, dans une application qui sait afficher les panneaux de mods.
- Sans panneau, le mod épingle un résumé sous le champ de saisie et laisse une note « Bord · … » dans la conversation à la fin de chaque tour. Selon l'application, ces lignes peuvent ne pas s'afficher.
- Les limites d'utilisation n'existent qu'avec un abonnement, et seulement après la première réponse du modèle.

## Fuseau horaire

Les heures de remise à zéro sont affichées en UTC+1 (Alger, sans heure d'été). Pour un autre fuseau, change `DECALAGE_MIN` dans `hooks/logic.ts`.

## Vérifier

```
claude plugin validate .
claude plugin test .
```
