# Frontières API – Sénégal 🇸🇳

API REST servant les **frontières administratives du Sénégal** au format **GeoJSON**, à partir d'une base **PostgreSQL / PostGIS**.

> **14 régions · 46 départements · 552 communes · 16 471 localités** — polygones complets et coordonnées géographiques, noms alignés sur le référentiel administratif officiel.

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Initialisation de la base](#initialisation-de-la-base)
- [Pipeline des localités](#pipeline-des-localités)
- [Lancement](#lancement)
- [Endpoints de l'API](#endpoints-de-lapi)
- [Format des réponses](#format-des-réponses)
- [Documentation Swagger](#documentation-swagger)
- [Tests](#tests)
- [Architecture du projet](#architecture-du-projet)
- [Optimisations](#optimisations)
- [Sources de données](#sources-de-données)
- [Déploiement sur Render](#déploiement-sur-render)
- [Inspiration](#inspiration)
- [Licence](#licence)

---

## Fonctionnalités

- Polygones **MultiPolygon** pour chaque division administrative du Sénégal
- **16 471 localités** géolocalisées (quartiers, villages, hameaux)
- Réponses au format **GeoJSON** (Feature & FeatureCollection), compatibles Leaflet, Mapbox, OpenLayers
- Filtrage hiérarchique : localités → communes → départements → régions
- Recherche de localités par nom (`/api/localites/search?q=`)
- Pagination sur les localités (`limit`, `offset`)
- Endpoint `/api/stats` avec compteurs temps réel
- Endpoint `/health` avec vérification de la base de données
- Documentation **Swagger/OpenAPI** à `/api/docs`
- **31 tests fonctionnels** (Jest + Supertest)
- Cache mémoire, compression gzip, rate limiting, sécurité (Helmet)
- Fichier `senegal.ts` inclus comme référentiel administratif

## Prérequis

- **Node.js** ≥ 18
- **PostgreSQL** ≥ 14 avec l'extension **PostGIS** installée

## Installation

```bash
git clone https://github.com/taphacoobams/frontieres_api.git
cd frontieres_api
npm install
```

## Configuration

Créer un fichier `.env` à la racine :

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=frontieres_db
DB_USER=postgres
DB_PASSWORD=your_password
PORT=3005
NODE_ENV=development
```

Puis créer la base de données PostgreSQL :

```sql
CREATE DATABASE frontieres_db;
\c frontieres_db
CREATE EXTENSION IF NOT EXISTS postgis;
```

## Initialisation de la base

```bash
npm run init-db
```

Crée les tables `regions_boundaries`, `departements_boundaries`, `communes_boundaries`, `localites_geo` avec leurs index spatiaux GIST.

## Pipeline des localités

Le pipeline importe et géolocalise les localités en 3 étapes :

### Étape 1 — Import SN.txt (GeoNames)

```bash
npm run import-localites
```

Importe les populated places depuis `SN.txt` (format GeoNames). Chaque localité est associée à sa commune par intersection spatiale (`ST_Contains`).

### Étape 2 — Correspondance GeoJSON (OSM)

```bash
npm run match-geojson
```

Croise les localités avec `localites.geojson` (export Overpass/OSM). Met à jour les coordonnées et insère les localités supplémentaires.

### Étape 3 — Fallback centroid

```bash
npm run fallback-centroid
```

Assigne les localités restantes sans commune à la commune la plus proche par distance (`<->`).

**Résultat** : 16 471 localités, toutes avec coordonnées et commune.

| Source | Localités |
|--------|-----------|
| SN.txt (GeoNames) | 8 169 |
| localites.geojson (OSM) | 8 302 |
| **Total** | **16 471** |

## Lancement

```bash
npm start        # production
npm run dev      # développement (nodemon)
```

L'API démarre sur `http://localhost:3005`.

## Endpoints de l'API

### Entités individuelles (GeoJSON Features)

| Méthode | URL | Description |
|---------|-----|-------------|
| `GET` | `/api/regions` | Toutes les régions |
| `GET` | `/api/regions/:id` | Une région par ID |
| `GET` | `/api/departements` | Tous les départements |
| `GET` | `/api/departements/:id` | Un département par ID |
| `GET` | `/api/departements?region_id=X` | Départements d'une région |
| `GET` | `/api/communes` | Toutes les communes |
| `GET` | `/api/communes/:id` | Une commune par ID |
| `GET` | `/api/communes?departement_id=X` | Communes d'un département |

### Localités

| Méthode | URL | Description |
|---------|-----|-------------|
| `GET` | `/api/localites` | Toutes les localités |
| `GET` | `/api/localites/:id` | Une localité par ID |
| `GET` | `/api/localites/search?q=Dakar` | Recherche par nom (min 2 car.) |
| `GET` | `/api/localites?commune_id=X` | Localités d'une commune |
| `GET` | `/api/localites?departement_id=X` | Localités d'un département |
| `GET` | `/api/localites?region_id=X` | Localités d'une région |
| `GET` | `/api/localites?limit=50&offset=0` | Pagination |

### FeatureCollections (pour cartographie)

| Méthode | URL | Description |
|---------|-----|-------------|
| `GET` | `/api/map/regions` | FeatureCollection de toutes les régions |
| `GET` | `/api/map/departements` | FeatureCollection de tous les départements |
| `GET` | `/api/map/communes` | FeatureCollection de toutes les communes |

### Système

| Méthode | URL | Description |
|---------|-----|-------------|
| `GET` | `/health` | Health check (avec état de la base) |
| `GET` | `/api/stats` | Statistiques globales |
| `GET` | `/api/docs` | Documentation Swagger/OpenAPI |

## Format des réponses

### Feature individuelle

```json
{
  "type": "Feature",
  "properties": {
    "id": 1,
    "region_id": 3,
    "name": "Dakar"
  },
  "geometry": {
    "type": "MultiPolygon",
    "coordinates": [...]
  }
}
```

### FeatureCollection (`/api/map/*`)

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "id": 1, "name": "Dakar", ... },
      "geometry": { "type": "MultiPolygon", "coordinates": [...] }
    }
  ]
}
```

Compatible directement avec **Leaflet**, **Mapbox GL**, **OpenLayers**, **D3.js**, etc.

### Localité

```json
{
  "id": 7806,
  "geonameid": 2253354,
  "name": "Dakar",
  "commune_id": 63,
  "departement_id": 7,
  "region_id": 1,
  "latitude": 14.6937,
  "longitude": -17.44406,
  "source": "sn_txt"
}
```

### Health

```json
{
  "status": "ok",
  "service": "frontieres-api",
  "database": "connected",
  "timestamp": "2026-03-06T15:00:46.838Z"
}
```

### Stats

```json
{
  "regions": 14,
  "departements": 46,
  "communes": 552,
  "localites": 16471,
  "localites_with_coordinates": 16471
}
```

## Documentation Swagger

Documentation interactive disponible à :

```
http://localhost:3005/api/docs
```

Inclut tous les endpoints, paramètres, schémas et exemples de réponses.

## Tests

```bash
npm test
```

**31 tests** répartis en 5 suites :

| Suite | Tests | Vérifie |
|-------|-------|---------|
| `health.test.js` | 2 | `/health`, `/api/stats` |
| `regions.test.js` | 4 | CRUD régions, structure GeoJSON, FeatureCollection |
| `departements.test.js` | 4 | CRUD départements, filtre `region_id`, FeatureCollection |
| `communes.test.js` | 4 | CRUD communes, filtre `departement_id`, FeatureCollection |
| `localites.test.js` | 17 | CRUD localités, recherche, filtres, pagination, coordonnées valides |

Technologies : **Jest** + **Supertest**

## Référentiel administratif

Le fichier `senegal.ts` contient la liste officielle des 14 régions, 46 départements et 552 communes du Sénégal, structurée hiérarchiquement :

```typescript
export const senegal = [
  {
    name: "Dakar",
    departements: [
      {
        name: "Dakar",
        communes: [
          { name: "Dakar Plateau" },
          { name: "Gorée" },
          ...
        ]
      },
      ...
    ]
  },
  ...
];
```

Ce fichier sert de **source de vérité** pour les noms des entités administratives.

## Architecture du projet

```
frontieres_api/
├── .env                    # Variables d'environnement (non versionné)
├── .gitignore
├── package.json
├── render.yaml             # Blueprint Render
├── senegal.ts              # Référentiel administratif officiel
├── README.md
├── tests/                  # Tests fonctionnels
│   ├── health.test.js
│   ├── regions.test.js
│   ├── departements.test.js
│   ├── communes.test.js
│   └── localites.test.js
└── src/
    ├── server.js           # Point d'entrée Express
    ├── swagger.json        # Spec OpenAPI 3.0
    ├── database/
    │   ├── connection.js   # Pool PostgreSQL (pg)
    │   └── init.js         # Création tables + index PostGIS
    ├── models/
    │   ├── regionBoundary.js
    │   ├── departementBoundary.js
    │   ├── communeBoundary.js
    │   └── localiteGeo.js
    ├── services/
    │   ├── regionService.js       # Logique métier + cache mémoire
    │   ├── departementService.js
    │   ├── communeService.js
    │   └── localiteService.js
    ├── controllers/
    │   ├── regionController.js    # Handlers HTTP
    │   ├── departementController.js
    │   ├── communeController.js
    │   └── localiteController.js
    ├── routes/
    │   ├── index.js               # Agrégation des routes
    │   ├── regionRoutes.js
    │   ├── departementRoutes.js
    │   ├── communeRoutes.js
    │   ├── localiteRoutes.js
    │   └── mapRoutes.js
    └── scripts/
        ├── import-localites.js    # Import SN.txt → PostGIS
        ├── match-geojson.js       # Correspondance GeoJSON
        └── fallback-centroid.js   # Fallback commune proche
```

## Optimisations

| Technique | Détail |
|-----------|--------|
| **Index GIST** | Index spatial sur chaque colonne `geometry` |
| **Cache mémoire** | TTL de 5 min, évite les requêtes SQL redondantes |
| **Compression gzip** | Réduit la taille des réponses (polygones = volumineux) |
| **Rate limiting** | 200 requêtes / 15 min par IP |
| **Helmet** | Headers de sécurité HTTP |
| **CORS** | Activé pour les appels cross-origin |

## Sources de données

| Source | Utilisation |
|--------|------------|
| [geoBoundaries (SEN)](https://www.geoboundaries.org/) | Régions (ADM1) et départements (ADM2) |
| [OpenStreetMap](https://www.openstreetmap.org/) | Communes (admin_level=8) et localités via Overpass API |
| [GeoNames (SN.txt)](https://download.geonames.org/export/dump/) | Localités (populated places) |
| Référentiel officiel | Noms et hiérarchie (`senegal.ts`) |

## Déploiement sur Render

### 1. Créer les services

**Option A — Blueprint (automatique) :**

1. Aller sur [render.com/blueprints](https://dashboard.render.com/blueprints)
2. Cliquer **New Blueprint Instance**
3. Connecter le repo `taphacoobams/frontieres_api`
4. Render détecte `render.yaml` et crée automatiquement la base PostgreSQL + le service web

**Option B — Manuel :**

1. **Créer une base PostgreSQL** :
   - Dashboard → **New** → **PostgreSQL**
   - Name : `frontieres-db`
   - Plan : Free
   - Valider, puis copier l'**Internal Database URL**

2. **Créer un Web Service** :
   - Dashboard → **New** → **Web Service**
   - Connecter le repo GitHub
   - Runtime : **Node**
   - Build Command : `npm install && npm run init-db`
   - Start Command : `node src/server.js`
   - Ajouter la variable d'environnement :
     - `DATABASE_URL` = l'Internal Database URL copiée

### 2. Activer PostGIS

Render fournit PostgreSQL mais l'extension PostGIS doit être activée. Dans le **Shell** de la base (Dashboard → base → Shell) :

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

> **Note :** `npm run init-db` exécute aussi cette commande, mais il est recommandé de le faire manuellement la première fois.

### 3. Importer les données

Depuis votre machine locale, exporter les données PostGIS et les importer sur Render via `pg_dump` / `pg_restore` :

```bash
# Export depuis votre base locale
pg_dump -Fc -d frontieres_db -t regions_boundaries -t departements_boundaries -t communes_boundaries -t localites_geo > dump.sql

# Import sur Render (utiliser l'External Database URL)
pg_restore -d "postgres://user:pass@host/dbname" --no-owner --no-acl dump.sql
```

L'**External Database URL** se trouve dans le Dashboard Render → PostgreSQL → Info → External Database URL.

### 4. Vérifier

```bash
curl https://votre-app.onrender.com/health
# → { "status": "ok", "service": "frontieres-api" }

curl https://votre-app.onrender.com/api/regions
# → 14 GeoJSON Features
```

> ⚠️ Le plan **Free** de Render met le service en veille après 15 min d'inactivité. La première requête après une veille prend ~30s.

## Inspiration

Ce projet est inspiré par [**decoupage_administratif_api**](https://github.com/TheShvdow/decoupage_administratif_api) de [@TheShvdow](https://github.com/TheShvdow), une API du découpage administratif du Sénégal. L'idée était d'aller plus loin en ajoutant les **polygones géographiques** (frontières) de chaque entité administrative, permettant ainsi la visualisation cartographique directe.

## Licence

MIT
