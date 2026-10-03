# Provider verification and launch review

Scryfall official pages were fetched directly on 2026-09-23 after the search tool returned 403. The collection endpoint documents a maximum of 75 references per request and a rate of two requests/second (500 ms). The adapter batches at 75 and uses a database-coordinated 600 ms slot across replicas, bounded queue wait, 8-second request timeout and at most three attempts. Retry-After greater than ten seconds returns an actionable unavailable response rather than ignoring the provider delay. Missing/null finish prices remain unknown.

- [Scryfall API](https://scryfall.com/docs/api)
- [Collection endpoint](https://scryfall.com/docs/api/cards/collection)
- [Bulk data](https://scryfall.com/docs/api/bulk-data)
- [Wizards locator](https://locator.wizards.com/)

Scryfall guidance requires preserving copyright/artist information and image proportions. The present UI uses decorative CSS art rather than cropped card imagery. If enabling the stored image URLs, use whole unmodified cards and preserve attribution; art crops require accompanying artist/copyright information. Do not present estimates as guaranteed trading values.

Source catalog and store metadata remain attached to imports. Wizards' locator GraphQL service has no contractual stability guarantee established by this task. Its data-use authorization, current terms, attribution and permitted production automation still need owner/provider review before launch. No inferred license or legal clearance is claimed. A bulk refresh or live Wizards importer was not run against those services during implementation.
