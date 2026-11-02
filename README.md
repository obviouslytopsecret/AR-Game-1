# Bumper Blobs

Party game: a laptop or TV hosts, phones join as controllers over the internet (PeerJS public broker).

Play: https://obviouslytopsecret.github.io/AR-Game-1/

The earlier AR Pong build lives on the `ar-pong-v1` branch.

## Modes

- **Sumo**: shove everyone off the shrinking rink with the stick and DASH. First to 3 round wins.
- **Fantasy Brawl**: same rink, but everyone picks one upgrade card before the match and every non-winner picks again after each round. Cards give an attack button (snowball, slash, frost bop, quake), attack upgrades, dash trails and dash upgrades, or a passive. Cards live in the `CARDS` table in `index.html`; add a row to add a card.

Pick the mode with the Mode button in the host lobby.
