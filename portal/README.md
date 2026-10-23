# Portail commercial Ortek — branche de développement

`preview.html` est un aperçu statique de l'interface avec des données fictives. Ouvrir ce fichier dans un navigateur pour parcourir les vues commercial, prospects, administration et workflow ; ses boutons ne modifient aucune donnée.

## Audit de l'existant (23 octobre 2026)

Le dépôt `cfruchart96-cyber/ortek.fr`, branche principale `main`, est un site statique HTML/CSS/JS avec `CNAME` pour `ortek.fr`. Aucun `package.json`, serveur, base de données, système d'identification, intégration Stripe ni workflow GitHub Actions n'est présent dans l'arbre audité. Les formulaires publics envoient les demandes à Formspree. Le `CNAME` est cohérent avec GitHub Pages, mais la configuration effective de Pages n'a pas été accessible par l'API liée : vérifier cette hypothèse dans les paramètres GitHub. Les fichiers publics n'ont pas été modifiés.

Offres relevées dans `index.html` : Présence 590 € + 19,90 €/mois, Vitrine 790 € + 29,90 €/mois, Réservation 990 € + 39,90 €/mois, Boutique dès 1 490 € + 69 €/mois. Le premier tarif boutique est un **minimum sur devis**, pas un prix ferme : il est donc bloqué pour l'édition autonome tant que l'administrateur n'a pas confirmé un tarif fixe adapté ou créé un flux de validation de devis personnalisé.

## Architecture proposée

- Le site public reste servi comme auparavant depuis `main`.
- `portal/` est une application Next.js séparée à héberger sur un sous-domaine privé, par exemple `portail.ortek.fr`, chez un hébergeur acceptant les fonctions serveur Next.js. Le choix exact de l'hébergeur reste ouvert. GitHub Pages seul ne peut pas exécuter ce portail.
- Supabase Auth et PostgreSQL gèrent les comptes et les données ; RLS isole les commerciaux. Un compte de service n'existe que dans les variables du serveur Next.js.
- Stripe Checkout encaisse les abonnements avec frais de création sur la première facture. Les webhooks signés déclenchent l'enregistrement atomique des paiements et commissions.
- Les PDF sont dans un bucket privé. Les liens client portent un secret aléatoire dont seul le hachage est stocké en base.
- Resend est utilisé pour les notifications applicatives. Les invitations sont envoyées par Supabase Auth et nécessitent un SMTP correctement configuré.

## Fonctions déjà codées sur cette branche

- Connexion avec MFA TOTP imposée à l'administrateur ; invitation, activation, suspension, révocation des sessions.
- Gestion des offres, droits par commercial, paramètres juridiques, règles de commission historiques.
- Import CSV de prospects (colonnes `company,city,website,phone,email,place_id`), répartition exclusive, réattribution et conversion ; unicité des emails de prospects.
- Devis PDF versionné avec identité légale obligatoire, acceptation explicite horodatée et empreinte PDF.
- Checkout d'abonnement en mode test ou réel selon la clé fournie ; webhook signé et idempotent ; publication du dossier prêt pour production seulement après facture effectivement payée.
- Suivi distinct des étapes : devis envoyé, accepté électroniquement, lien de paiement créé, tentative échouée et facture Stripe payée. Une tentative échouée peut être régularisée par Stripe sans créer deux commissions.
- Tableau de bord et historique de commissions, email en file d'attente, reprise de la file par une tâche planifiée protégée par `CRON_SECRET`.

## Mise en place **en test uniquement**

1. Créer un projet Supabase de test, appliquer les migrations SQL dans l'ordre `001` à `006` et vérifier le bucket privé `quotes`.
2. Créer le compte administrateur dans Supabase Auth, puis ajouter **manuellement** sa ligne `profiles` avec son UUID, `role='admin'` et `status='active'`. Ne pas inclure d'email réel ou de secret dans Git.
3. Configurer le SMTP Supabase pour l'envoi des invitations, les URL de redirection vers `/auth/callback?activate=1` et l'authentification MFA TOTP.
4. Copier `.env.example` vers `.env.local` hors Git, renseigner les clés de **test** Supabase/Stripe, un domaine d'envoi vérifié, l'email administrateur et l'URL du portail. Ne pas utiliser de clés Stripe de production pour les essais.
5. `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, puis `npm run dev`.
6. Configurer un endpoint webhook Stripe de test vers `/api/stripe/webhook` avec au minimum `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` ; renseigner le secret de signature reçu.
7. Configurer une tâche planifiée qui appelle `POST /api/cron/notifications` avec `Authorization: Bearer <CRON_SECRET>`.
8. Compléter et faire valider l'identité légale, la mention TVA et les conditions contractuelles dans `/admin` avant le premier devis.

## Créer un espace commercial

Après configuration de Supabase et du SMTP, l'administrateur ouvre `/admin`, saisit le nom et l'email du commercial dans « Inviter un commercial » et envoie l'invitation. L'email sert d'identifiant ; le commercial définit son mot de passe sur la page d'activation. L'administrateur lui autorise ensuite les offres et crée sa règle de commission. Le portefeuille CSV peut lui être attribué ou réattribué depuis `/admin`. Dans `/commercial`, le commercial voit ses devis, les statuts de factures Stripe et les commissions effectivement acquises. La validation d'un devis seule ne déclenche aucune commission ; une facture payée et vérifiée par webhook est nécessaire.

## À terminer avant un usage réel

Cette branche est un socle fonctionnel, **pas un portail prêt à ouvrir aux commerciaux**. Il reste à :

- Exécuter les tests de parcours de bout en bout avec deux commerciaux, un admin MFA, Supabase et Stripe **en mode test** ; vérifier concrètement RLS, invitation, PDF, paiement, renouvellement, échec, remboursement et redirection.
- Faire une revue de sécurité indépendante et une revue juridique du devis/consentement, du mandat commercial, de la conservation des données et des conditions de vente.
- Gérer les remboursements et avoirs (dont remboursements partiels), la régularisation des impayés et annulations dans le grand livre ; créer une réconciliation périodique Stripe et une procédure de litige. Les statuts d'abonnement sont suivis, mais ces événements ne déclenchent pas encore de régularisation financière automatique.
- Ajouter les notifications d'échec/résiliation/versement, les exports de relevés, filtres et recherche, une pagination complète, les statuts de production modifiables et des primes de performance conditionnelles.
- Prévoir sauvegardes, restauration testée, rétention/suppression des données, surveillance des erreurs de webhook et de la file email, ainsi qu'un hébergeur et son coût réel.
- Pour les offres « dès ... sur devis », prévoir une approbation du prix personnalisé avant la génération du PDF.

Un paiement n'est jamais confirmé par un retour navigateur. Une facture Stripe dont le montant ne correspond pas exactement à la somme contractuelle est rejetée du traitement automatique et nécessite une intervention.
