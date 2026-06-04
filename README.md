# Relay — marketing site

The product site for **Relay**, served at https://relay.autumated.com.
Static HTML/CSS/JS, no build step, no framework. Dark-first with a persisted
theme toggle and an ambient backdrop. Built from the same design system as the
Relay app, so the site and the app read as one family.

Pages: `index` · `use-cases` · `docs` (with the DIY guides) · `pricing` · `blog`.

## Deploy
GitHub Pages from the repo root. `CNAME` points at `relay.autumated.com`; add a
DNS record `relay CNAME abdk4moura.github.io` at the autumated.com DNS provider.

## License
The Relay client software (phone app, desktop receiver, wire protocol, bridge
firmware) is open source under **GPLv3**, and this site is GPLv3 too. The hosted
relay, the fleet console, and the agent cloud are the paid services.
