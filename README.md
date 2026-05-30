# ManaBinder

ManaBinder is a production-shaped Magic: The Gathering trade binder app. It has server-side login, persistent user data, Massachusetts WPN store selection, printing-aware binders, and a Magic-inspired interface.

## Run

```sh
npm run import:cards
npm start
```

Then open `http://127.0.0.1:4174`.

## Store Import

ManaBinder imports Massachusetts stores from the official Wizards Store and Event Locator GraphQL service.

```sh
npm run import:stores:ma
```

The importer queries stores near the geographic center of Massachusetts, filters returned addresses to `MA`, and writes `data/stores.massachusetts.json` with Wizards store IDs and source metadata.

## Card Library Import

ManaBinder imports Scryfall Default Cards bulk data into a local searchable card catalog:

```sh
npm run import:cards
```

The importer writes `data/cards.scryfall.json` with card identities, paper printings, set metadata, treatments, rarity, and image URLs. It intentionally omits prices.

## Current Production Foundation

- Server-side signup, login, logout, and HttpOnly session cookies.
- Salted `scrypt` password hashes.
- JSON persistence in `data/db.json` for local development.
- WPN store dataset in `data/stores.massachusetts.json`.
- Full local Magic card library in `data/cards.scryfall.json`.
- Printing-specific binder entries.
- Public binder search by selected store.
- Card prices are not stored in listings and are omitted from catalog/search API responses.
- Scryfall prices are polled only while quoting or sending a trade request.

## Next Production Steps

- Replace JSON files with Postgres or another managed database.
- Set `SESSION_SECRET` in the deployment environment.
- Add CSRF protection before public deployment.
- Expand trade-request APIs and notifications.
- Replace the sample card catalog with a Scryfall bulk-data import.
