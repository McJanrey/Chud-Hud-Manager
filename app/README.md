# Saints HUD

The St. Clair Saints broadcast control room. One desktop app to manage events, teams, talent and graphics, and to feed live game data into OBS overlays.

- **Rocket League:** reads the game's official Stats API.
- **League of Legends:** reads Riot's Live Client Data API. Works in live games, spectating and replays.
- **Overwatch, Call of Duty, Deadlock, Fortnite, Valorant and others:** Screen OCR reads scores, the clock and team names from the screen.

## Install

Download `SaintsHUD-Setup-x.y.z.exe` from the [latest release](https://github.com/McJanrey/saints-hud/releases/latest) and run it. Windows may warn about an unknown publisher because the app isn't code-signed: choose **More info → Run anyway**.

Installed copies update themselves. The app checks GitHub Releases on launch and every hour, downloads new versions in the background, and asks to restart. **Help → Check for updates** checks right away.

Your events, teams and logos live in `%APPDATA%\Saints HUD\data` (**File → Open data folder**), so updates keep them.

## Add the overlay to OBS

In the app, **File → Copy overlay URL for OBS**, then add a **Browser** source in OBS:

- URL: `http://localhost:7777/overlay?scene=auto` (the app has to be open)
- Width 1920, height 1080

`scene=auto` follows the scene picked in HUD Editor, so the producer can switch graphics live. To pin a source to one scene use `?scene=ingame`, `?scene=casters`, `?scene=bracket` and so on.

Scenes: Ingame HUD, Bracket, Caster Nameplates, Lower Thirds, Rankings Screen, Replay, Schedule, Starting Soon, Stats Page Individual, Stats Page Team, Team Lineup, Timer, Title Screen.

## Live game data

The default data source is **Auto**: it reads the real game for the on-air event. Rocket League and League of Legends read their own data; every other game uses Screen OCR. The **Test match** option in Live Game is the only simulated feed and is clearly marked.

### Rocket League

On the game PC, open `<Rocket League install>\TAGame\Config\TAStatsAPI.ini` (or `DefaultStatsAPI.ini`) and under `[TAGame.MatchStatsExporter_TA]` set:

```ini
PacketSendRate=30
Port=49123
```

Restart the game, then spectate or play. Boost, score, goals, assists, saves, the clock, overtime, the spectated player and goal replays update on their own. Live Game can also change the in-game camera, watch a player, hide the game HUD and pause the match.

### League of Legends

Nothing to set up. Run Saints HUD on the PC that is playing, spectating or watching a replay. Spell roster IGNs exactly like the in-game Riot ID (without the `#tag`) so teams match automatically.

The HUD shows team kills, team gold, the gold lead, towers, dragons, barons and a clock in a scorebar. Objective timers for Dragon and Baron sit in the top-left corner. A lane panel along the bottom shows each lane's items, K/D/A, CS, gold and the gold lead between the two players. A banner announces dragons, barons, towers, aces and first blood.

Gold is the value of the items each player owns. Riot's live API doesn't expose total earned gold. Objective timers follow standard Summoner's Rift rules (dragon at 5:00 then every 5:00 after a kill; Baron at 20:00 then every 6:00 after a kill) and can be adjusted in `server.js`.

**Replay controls.** League only offers play, pause, speed and seek through its Replay API, which is off by default. In **Live Game**, click **Turn on Replay API** (it adds `EnableReplayApi=1` to `Config\game.cfg`), then close the replay and open it again. Set `LOL_DIR` if League isn't installed in `C:\Riot Games\League of Legends`.

### Screen OCR (other games)

Open **Screen OCR**:

1. Pick the screen or window showing the game. The game has to run in **borderless windowed** mode; exclusive fullscreen can't be captured.
2. Drag boxes over the left score, right score, game clock and team names. Use **Test** on each box to see exactly what the reader sees.
3. Press **Start reading**.

Values are accepted once two reads in a row agree, so a single misread never reaches the broadcast. Readings are sent to the HUD as the team scores, the clock and team names. Team names are matched to the teams in your event.

Starting layouts are only guesses: every game's HUD is different, so place the boxes on your game. To check the engine on a PC, run `"Saints HUD.exe" --ocr-selftest`.

### Other trackers

Any program can send Stats API–shaped JSON to `http://localhost:7777/api/ingest`, with the data source set to **External**:

```json
{ "Event": "UpdateState", "Data": {
  "Players": [{ "Name": "Jazii", "TeamNum": 1, "Shortcut": 4, "Score": 210, "Goals": 1, "Boost": 67 }],
  "Game": { "Teams": [{ "TeamNum": 0, "Score": 0 }, { "TeamNum": 1, "Score": 1 }],
            "TimeSeconds": 293, "bOvertime": false, "bHasTarget": true,
            "Target": { "Name": "Jazii", "Shortcut": 4, "TeamNum": 1 } } } }
```

## Develop

1. Install [Node.js LTS](https://nodejs.org), then run `npm install` in this folder.
2. `npm start` runs the desktop app from source. `npm test` runs the OCR self-check.
3. `npm run dist` builds the installer and a portable exe into `dist/`.

### Publish an update

1. Bump `version` in `package.json`.
2. Build and upload with a GitHub token that can write to the repo:
   ```powershell
   $env:GH_TOKEN = (gh auth token); npm run release
   ```
   This uploads the installer and `latest.yml` to a GitHub release for that version, and installed copies pick it up.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 7777 | Overlay and dashboard port |
| `HOST` | 127.0.0.1 | Listen address (`0.0.0.0` to reach it from other PCs; there is no login) |
| `RL_HOST` / `RL_PORT` | 127.0.0.1 / 49123 | Rocket League Stats API |
| `LOL_HOST` / `LOL_DIR` | 127.0.0.1 / `C:\Riot Games\League of Legends` | League API host and install folder |
