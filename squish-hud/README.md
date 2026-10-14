# Squish HUD

A local broadcast control room for esports events. One dashboard to manage teams, talent, tournament graphics and the live match, plus overlay pages you add to OBS or vMix. Rocket League data comes straight from the game's official Stats API, so scores, boost, the spectated player and goals update on their own.

## Install the desktop app

Download `SaintsHUD-Setup-x.y.z.exe` from the [latest release](https://github.com/McJanrey/saints-hud/releases/latest) and run it. Windows may warn that the app is from an unknown publisher because it isn't code-signed: choose **More info → Run anyway**.

The app opens the control room in its own window. While it's open, OBS can read the overlay at `http://localhost:7777/overlay?scene=auto` (**File → Copy overlay URL for OBS**).

Installed copies update themselves: the app checks GitHub Releases on launch and every hour, downloads new versions in the background, and asks to restart. **Help → Check for updates** checks right away.

Your events, teams and logos are stored in `%APPDATA%\Saints HUD\data` (**File → Open data folder**), so updates and reinstalls keep them.

## Develop

1. Install [Node.js LTS](https://nodejs.org) (18 or newer), then run `npm install` in this folder.
2. `npm start` runs the desktop app from source. `npm run server` (or `START.bat`) runs just the server, which you open in a browser at http://localhost:7777.
3. `npm run dist` builds the installer and a portable exe into `dist/`.

### Publish an update

1. Bump `version` in `package.json` (for example 0.2.0 → 0.2.1).
2. Run the release build with a GitHub token that can write to the repo:
   ```powershell
   $env:GH_TOKEN = (gh auth token); npm run release
   ```
   This uploads the installer and `latest.yml` to a GitHub release for that version, and every installed copy picks it up.

## Connect Rocket League

On the PC running the game:

1. Open `<Rocket League install>\TAGame\Config\TAStatsAPI.ini`. If it doesn't exist, use `DefaultStatsAPI.ini`.
2. Under `[TAGame.MatchStatsExporter_TA]` set:
   ```ini
   PacketSendRate=30
   Port=49123
   ```
3. Restart Rocket League. Changes only apply on launch.
4. In the dashboard go to **Live Game → Data source → Rocket League**.

Spectate the match (as an observer) to receive boost, speed and the currently viewed player. From the Live Game page you can also switch the in-game camera, watch a specific player, hide the game HUD and pause the match.

If Squish runs on a different PC than the game, set `RL_HOST` to the game PC's address. Rocket League may only accept local connections, in which case run Squish on the game PC.

## Connect League of Legends

League needs no setup. Riot's Live Client Data API runs on `https://127.0.0.1:2999` whenever a game or spectate is running on that PC.

1. Run Squish on the PC that is playing or spectating (set `LOL_HOST` if it's elsewhere and reachable).
2. In the dashboard pick **Live Game → Data source → League of Legends**.
3. Spell roster IGNs exactly like the in-game Riot ID, without the `#tag`, so teams are matched automatically.

The League HUD shows team kills, game time, towers, barons and dragon types, plus both teams' champions with level, K/D/A, CS and respawn timers. A kill feed covers first blood, multikills, aces, dragons, heralds, barons, towers and inhibitors. Champion icons come from Riot's Data Dragon CDN, so the overlay PC needs internet access.

With the data source on **Demo feed** and a League event on air, Squish simulates a League match at 4× speed.

## Add the overlay to OBS

Add a **Browser** source:

- URL: `http://localhost:7777/overlay?scene=auto`
- Width 1920, height 1080

`scene=auto` follows the scene picked in HUD Editor, so the producer can switch graphics live. You can also pin a source to one scene, e.g. `?scene=ingame`, `?scene=casters`, `?scene=bracket`.

Scenes: Ingame HUD, Bracket, Caster Nameplates, Lower Thirds, Rankings Screen, Replay, Schedule, Starting Soon, Stats Page Individual, Stats Page Team, Team Lineup, Timer, Title Screen.

The Ingame HUD switches to Replay during goal replays, and to Team Stats on the podium when "Team stats on podium" is ticked.

## Feeding other games (OCR, custom trackers)

Set the data source to **External / OCR** and POST JSON to `http://localhost:7777/api/ingest`, using the same shape as the Rocket League Stats API:

```json
{ "Event": "UpdateState", "Data": {
  "Players": [{ "Name": "Jazii", "TeamNum": 1, "Shortcut": 4, "Score": 210, "Goals": 1, "Boost": 67 }],
  "Game": { "Teams": [{ "TeamNum": 0, "Score": 0 }, { "TeamNum": 1, "Score": 1 }],
            "TimeSeconds": 293, "bOvertime": false, "bHasTarget": true,
            "Target": { "Name": "Jazii", "Shortcut": 4, "TeamNum": 1 } } } }
```

Events like `GoalScored`, `StatfeedEvent`, `MatchEnded` and `GoalReplayStart` are accepted too. You can send an array of messages in one request.

## Using it across PCs

By default the server only listens on this PC. To reach the dashboard or overlay from another machine on your network, start it with `HOST=0.0.0.0` (`npm run lan`). There is no login, so only do this on a network you trust.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 7777 | Dashboard and overlay port |
| `HOST` | 127.0.0.1 | Listen address |
| `RL_HOST` | 127.0.0.1 | Rocket League PC |
| `RL_PORT` | 49123 | Stats API TCP port |
