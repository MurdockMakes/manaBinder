# Mana Trade Binder

Mana is a browser-based prototype for public Magic trade binders and balanced trade requests.

## Run

Open `index.html` directly, or serve the folder locally:

```sh
python3 -m http.server 4173
```

Then visit `http://127.0.0.1:4173/index.html`.

## Implemented

- Account creation prompts only for email, site-wide nickname, and password.
- Email validation accepts any normal email provider, not just Gmail.
- Store preferences are managed separately from account creation.
- Users can add cards to a public binder with visible card wear and notes.
- Public binders can be searched by the user's stores, all stores, area, and card name.
- Trade requests start from public binder cards.
- Trade fairness uses hidden card values and condition adjustments.
- Users only see balance guidance: add more, remove, or about even.
- Requests can only be sent when the hidden value difference is inside a tight margin.

## Price Data

The current version uses seeded local card values so the app works without a backend. For production, replace the `price` values in `app.js` with a server-side market-price feed and keep prices out of client-visible UI.
