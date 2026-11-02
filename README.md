# AR-Game-1

Phone-controlled party games for a TV or laptop. The big screen hosts and shows a room code and QR code; phones scan to join (PeerJS public broker).

- **Pocket Sports** (3D, phones as motion controllers): https://obviouslytopsecret.github.io/AR-Game-1/
- **Bumper Blobs** (2D party brawler): https://obviouslytopsecret.github.io/AR-Game-1/blobs/

`/sports/` redirects to the root so older links keep working. Development of the 3D pack happens on the `sports-3d` branch; main mirrors it.

## Pocket Sports
- Free Play: pick one game and set its rules. Season: short minigames for points, picked by phone vote or random roll; 1v1 games rotate a sit-out with 3 players and become a bracket with 4.
- **Ping Pong**: 1v1 vertical split screen. Swing the phone like a paddle; the paddle moves to the ball for you. Early swing = left, late = right, twisting the face aims, swing up = topspin, chop = slice, harder = deeper. Swipe fallback for phones without motion. Empty seats are CPU.

Code: `index.html` is the shell (lobby, season, networking, phone controller, shared 3D helpers); `games/<id>.js` is one file per game via `registerGame()`; `lib/` vendors three.js r160, PeerJS 1.5.5 and qrcode-generator 1.4.4. Testing hook: `?broker=host:port` for a local PeerJS server.

## Bumper Blobs
Modes: Sumo, Fantasy Brawl, Soccer. Pick the mode with the Mode button in the host lobby. The earlier AR Pong build lives on the `ar-pong-v1` branch.
