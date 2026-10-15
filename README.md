# DMC Patient Feedback

## Local testing and demo

Serve the project as a static site using VS Code Live Server or another local static file server, then open its URL on the testing device. The survey, submission progress, responses, and 24-hour repeat-submission lock run entirely in the browser and use `localStorage`; no API server or internet connection is required.

Responses are stored under `dmc_r` in the browser's site storage and are available to the local admin view in that same browser. The completion screen is restored after refresh, and that browser cannot submit again for 24 hours.

This is a browser-local demo only: responses do not reach a central database or appear on another device. Clearing site storage or using another browser can reset the local data and repeat-submission lock. Keep the current testing URL and browser storage stable while testing.

## Future server integration

Server-side storage and cross-device repeat-submission protection are deferred until the local demo is tested and approved. `server.js` is not required by the current browser flow.

## Verify

```sh
npm test
```
