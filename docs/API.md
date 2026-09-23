# API and compatibility

GET `/api/session` returns `{user, csrfToken, cards, stores}`. Use its CSRF token in `X-CSRF-Token`; all POST/PATCH/DELETE requests require exact configured `Origin`, `Content-Type: application/json` and a JSON object, even when empty. Refresh the token from session after signup/login/logout/reset because cookies rotate. Cookies are opaque, HttpOnly, expire after seven days, and are revocable. Production cookies are Secure.

Bodies are capped at 32 KiB. Strict route field lists reject extra fields. Intentional responses include 400 invalid input, 401 login required, 403 authorization/CSRF, 404 not found, 409 stock/idempotency conflict, 413 oversized body, 415 content type and 429 abuse limit (Retry-After). Private responses use no-store; logs contain request ID, method, status and timing only.

| Routes                                                       | Methods / input                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/signup`, `/api/login`, `/api/logout`                   | POST email/nickname/password; email/password; empty object respectively                                                                    |
| `/api/account/verification-request`, `/api/account/verify`   | POST empty object; `{token}`                                                                                                               |
| `/api/account/reset-request`, `/api/account/reset`           | POST `{email}`; `{token,password}`                                                                                                         |
| `/api/account/password`                                      | POST `{currentPassword,password}`; invalidates every session                                                                               |
| `/api/account/export`, `/api/account`                        | GET export; DELETE `{password}` removes account and its trades                                                                             |
| `/api/cards?q=&limit=&offset=`                               | GET, maximum 80 results, `nextOffset`                                                                                                      |
| `/api/me/stores`                                             | PATCH `{storeIds:[]}`                                                                                                                      |
| `/api/me/binder`, `/api/me/collection`                       | POST `{cardId,printingId,finish,condition,quantity,note?,location?}`; quantity integer 1–99                                                |
| `/api/me/binder/:id`, `/api/me/collection/:id`               | DELETE, rejects reserved inventory                                                                                                         |
| `/api/me/looking-for`, `/api/me/looking-for/:id`             | POST `{cardId,priority,note?}`; DELETE                                                                                                     |
| `/api/binders?storeId=&wantedByUserId=&limit=&offset=`       | GET, maximum 40 owners, `nextOffset`; wantedByUserId must be the authenticated user                                                        |
| `/api/trades/quote`, `/api/trades`                           | POST `{targetUserId,requestedItems:[{id,quantity}],offeredItems:[{id,quantity}]}`; send also requires unique `Idempotency-Key` 8–100 chars |
| `/api/trades?before=`                                        | GET participant inbox/outbox, 50 rows and `nextBefore` timestamp                                                                           |
| `/api/trades/:id`                                            | GET participant-only snapshots and events, never quote prices or private collection locations                                              |
| `/api/trades/:id/accept`, `/decline`, `/cancel`, `/complete` | POST empty object; recipient alone accepts/declines; both participants may cancel/confirm handoff                                          |
| `/api/notifications`, `/api/notifications/read`              | GET latest 100; POST mark user's notifications read                                                                                        |
| `/api/blocks`                                                | POST / DELETE `{targetId}`                                                                                                                 |
| `/api/reports`                                               | POST `{targetId,reason}`                                                                                                                   |
| `/api/admin/reports`, `/api/admin/metrics`                   | GET, operator configured ADMIN_IDS only                                                                                                    |
| `/api/admin/moderate`                                        | POST `{targetId,action:'disable'                                                                                                           | 'enable' | 'resolve',reportId?}` |
| `/healthz`, `/readyz`                                        | GET process health; database/schema/catalog readiness                                                                                      |

Breaking changes: inventory writes must supply finish; collection quantity is an integer rather than a coerced string. Cross-user wanted filtering is forbidden. New sessions require login; writes need CSRF and Origin. Old trade ID arrays remain accepted and mean one copy of each selected item. New explicit item arrays are preferred. Unknown/duplicate/foreign IDs are errors. Legacy pricing and development signing-secret fallback are gone.

Limits: 1,000 active inventory entries/account, 1,000 wanted cards, 150 selections per trade side. The first release's inbox UI shows the latest 50 trades (older history remains queryable by API); building a full history browser is a documented deferred convenience feature. Public binder pagination has a More button.
