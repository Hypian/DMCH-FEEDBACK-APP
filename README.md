# DMC Patient Feedback

## Run locally

Use Node.js 22.5 or newer:

```sh
npm start
```

Open `http://localhost:5173`. The first launch creates `data/feedback.sqlite` and a private device-ID hash key in `data/`. Keep this directory on persistent storage and out of source control; losing the key resets the cooldown records.

## Browser cooldown and QR codes

The app creates a random ID in the browser's local storage and checks it before showing the questionnaire. The server allows one submission per browser ID every 24 hours and checks again when feedback is submitted to handle simultaneous attempts. It stores only a keyed HMAC hash and submission time, not the ID itself or feedback, in the cooldown database. Feedback responses continue to be stored locally in the browser, as before.

After a successful submission, the app keeps the thank-you screen visible without a timeout and restores it after a refresh while the 24-hour cooldown is active.

A QR code should point to the publicly hosted app URL. The app and `/api/check` and `/api/submit` must be served from the same origin, over HTTPS, with persistent storage for the `data/` directory. Do not use `localhost` in the QR code. Every app instance must share the same database and device-ID hash key for the cooldown to apply across devices and servers.

This anonymous ID identifies a browser profile, not a person or a physical device. Clearing that browser's site storage, switching browsers, or using another device creates a new ID and can allow another submission. Browser code cannot reliably read a hardware ID; use account sign-in or phone verification if stronger identity checks are needed.

## Verify

```sh
npm test
```
