# Security

## Reporting a problem

Please report security problems privately, not in a public issue. Open the **Security** tab of this repository and choose **Report a vulnerability**, with steps to reproduce.

## What counts

The demo is a static page: no server, no accounts, no stored data. The engine runs in your browser as WebAssembly. The things worth reporting are problems in the page itself, such as script injection through plan text, uploaded CSV or forecast data, or a way to make it load something it shouldn't.

Live forecasts and place search call Open-Meteo directly from your browser, so Open-Meteo sees the visitor's IP address and the coordinates requested. Nothing goes to any other service.

For problems in the engine (crashes or hangs on crafted input), see the [wint security policy](https://github.com/aunai-org/wint/blob/master/SECURITY.md).

## Supported versions

Only the current version of the page.
