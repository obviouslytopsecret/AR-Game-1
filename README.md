# Bumper Blobs

Party game: a laptop or TV hosts, phones join as controllers over the internet (PeerJS public broker).

Play: https://obviouslytopsecret.github.io/AR-Game-1/

3D sports pack (phones as motion controllers): https://obviouslytopsecret.github.io/AR-Game-1/sports/ (source of truth on the `sports-3d` branch; `sports/` on main is a copy so Pages can serve it).

The earlier AR Pong build lives on the `ar-pong-v1` branch.

## Modes

- **Sumo**: shove everyone off the shrinking rink with the stick and DASH. First to 3 round wins.
- **Fantasy Brawl**: same rink, but everyone picks one upgrade card before the match and every non-winner picks again after each round. Cards give an attack button (snowball, slash, frost bop, quake), attack upgrades, dash trails and dash upgrades, or a passive. Cards live in the `CARDS` table in `index.html`; add a row to add a card.
- **Soccer**: Orange vs Green on a walled pitch. Push the ball into the other team's goal, DASH for a hard kick. Mystery `?` cubes give one held item (snowball, goo, ice patch, turbo, ramp, magnet, big boot, shockwave), used with the second phone button. Items live in the `ITEMS` table. First team to 3 goals wins. Teams auto-balance on join; switch with the phone's team button or by tapping a player in the host lobby.

Pick the mode with the Mode button in the host lobby.
