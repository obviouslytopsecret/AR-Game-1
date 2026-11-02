# Pocket Sports

3D sports minigames on a TV or laptop, with phones as motion controllers. Same join flow as Bumper Blobs: the big screen hosts and shows a room code and QR code, phones scan to join (PeerJS public broker).

Play: https://obviouslytopsecret.github.io/AR-Game-1/sports/

## Games
- **Ping Pong** (1v1, vertical split screen). Swing the phone like a paddle; the paddle moves to the ball for you. Timing aims (early = left, late = right), twisting the phone face aims too, swinging up gives topspin, chopping down gives slice, harder = deeper. Empty seats are CPU. Phones without motion can swipe up instead.

Coming: season mode (short minigames for points), bowling, tennis, golf, archery, tilt-ball games and more.

## Code layout
- `index.html`: the shell. Lobby, room code/QR, PeerJS networking, phone controller (motion permission, recenter, swing detection, swipe fallback), shared 3D helpers (`Core.makeBuddy`, `Core.makeRoom`), split-screen rendering.
- `games/<id>.js`: one file per game. Each calls `registerGame({id, name, icon, max, options, howto, create(core, opts)})`. The instance implements `begin()`, `step(dt)`, `draw(dt)`, `swing(seat, swing)`, `padState(seat)` and `destroy()`.
- `lib/`: three.js r160, PeerJS 1.5.5, qrcode-generator 1.4.4 (vendored, no build step).

Testing hook: add `?broker=host:port` to use a local PeerJS server.
