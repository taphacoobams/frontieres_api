# Frontières API – Sénégal 🇸🇳

API REST servant les **frontières administratives du Sénégal** au format **GeoJSON**, à partir d'une base **PostgreSQL / PostGIS**.

> **14 régions · 46 départements · 552 communes** — polygones complets, noms alignés sur le référentiel administratif officiel.

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Import des données](#import-des-données)
- [Lancement](#lancement)
- [Endpoints de l'API](#endpoints-de-lapi)
- [Format des réponses](#format-des-réponses)
- [Référentiel administratif](#référentiel-administratif)
- [Architecture du projet](#architecture-du-projet)
- [Optimisations](#optimisations)
- [Sources de données](#sources-de-données)
- [Licence](#licence)

---

## Fonctionnalités

- Polygones **MultiPolygon** pour chaque division administrative du Sénégal
- Réponses au format **GeoJSON** (Feature & FeatureCollection), compatibles Leaflet, Mapbox, OpenLayers
- Filtrage hiérarchique : communes par département, départements par région
- Cache mémoire, compression gzip, rate limiting, sécurité (Helmet)
- Script d'import automatisé depuis des fichiers GeoJSON sources
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

Crée les tables `regions_boundaries`, `departements_boundaries`, `communes_boundaries` avec leurs index spatiaux GIST.

> Les données géographiques (polygones) doivent être importées séparément dans PostGIS depuis des fichiers GeoJSON ([geoBoundaries](https://www.geoboundaries.org/), [OpenStreetMap](https://www.openstreetmap.org/)).

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

### FeatureCollections (pour cartographie)

| Méthode | URL | Description |
|---------|-----|-------------|
| `GET` | `/api/map/regions` | FeatureCollection de toutes les régions |
| `GET` | `/api/map/departements` | FeatureCollection de tous les départements |
| `GET` | `/api/map/communes` | FeatureCollection de toutes les communes |

### Système

| Méthode | URL | Description |
|---------|-----|-------------|
| `GET` | `/health` | Health check |

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
├── senegal.ts              # Référentiel administratif officiel
├── README.md
└── src/
    ├── server.js           # Point d'entrée Express
    ├── database/
    │   ├── connection.js   # Pool PostgreSQL (pg)
    │   └── init.js         # Création tables + index PostGIS
    ├── models/
    │   ├── regionBoundary.js
    │   ├── departementBoundary.js
    │   └── communeBoundary.js
    ├── services/
    │   ├── regionService.js       # Logique métier + cache mémoire
    │   ├── departementService.js
    │   └── communeService.js
    ├── controllers/
    │   ├── regionController.js    # Handlers HTTP
    │   ├── departementController.js
    │   └── communeController.js
    └── routes/
        ├── index.js               # Agrégation des routes
        ├── regionRoutes.js
        ├── departementRoutes.js
        ├── communeRoutes.js
        └── mapRoutes.js
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
| [OpenStreetMap](https://www.openstreetmap.org/) | Communes (admin_level=8) via Overpass API |
| Référentiel officiel | Noms et hiérarchie (`senegal.ts`) |

## Inspiration

Ce projet est inspiré par [**decoupage_administratif_api**](https://github.com/TheShvdow/decoupage_administratif_api) de [@TheShvdow](https://github.com/TheShvdow), une API du découpage administratif du Sénégal. L'idée était d'aller plus loin en ajoutant les **polygones géographiques** (frontières) de chaque entité administrative, permettant ainsi la visualisation cartographique directe.

## Licence

MIT
