import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import './App.css';


/* ---------- Saving and loading helpers ---------- */

// [NEW] A tiny helper that reads something we saved earlier in the browser.
// If nothing was saved yet (or the saved data is broken), it just gives back
// the "fallback" value so the app doesn't crash.
function loadJSON(key, fallback) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    return saved ?? fallback;
  } catch {
    return fallback;
  }
}

// [NEW] Real FM radio stations sit on odd tenths, like 88.1, 88.3, 88.5 ... 107.9.
// That gives us 100 possible spots on our dial. We write them as whole numbers
const FM_FIRST = 881; // 88.1 MHz
const FM_SLOTS = 100; // how many spots fit between 88.1 and 107.9

// [NEW] Gives a station its own frequency that never changes.
// How it works: we turn the station's id into a number, use that to pick a spot
// on the dial, and if that spot is already taken we just try the next one.
// Why we need this: before, a station's frequency was based on its position in
// the list. So adding a new friend shifted everybody's frequency around, which
// would have broken things like presets. Now each station keeps its number for good.
function assignFrequency(id, taken) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = 0; i < FM_SLOTS; i++) {
    const slot = (hash + i) % FM_SLOTS;
    const freq = ((FM_FIRST + slot * 2) / 10).toFixed(1);
    if (!taken.has(freq)) return freq;
  }
  return "88.1"; // only happens if all 100 spots are full, which is very unlikely
}

// [CHANGED] Loads the saved stations when the app opens.
// New: if a station was saved before this update, it won't have a frequency yet,
// so we give it one here. That way nobody loses their existing stations.
function loadStations() {
  const saved = loadJSON("friend.fm.stations", []);
  if (!Array.isArray(saved)) return [];
  const taken = new Set(saved.filter(s => s.frequency).map(s => s.frequency));
  const stations = saved.map(station => {
    if (station.frequency) return station;
    const frequency = assignFrequency(station.id, taken);
    taken.add(frequency);
    return { ...station, frequency };
  });
  localStorage.setItem("friend.fm.stations", JSON.stringify(stations));
  return stations;
}

// Takes whatever the user pasted and pulls out the Spotify playlist id from it.
// [CHANGED] If they paste something that isn't a link at all (like "hello"),
// `new URL()` used to crash with a confusing "Invalid URL" message. Now we catch
// that and show a friendly "Use a Spotify playlist link." instead.
function getPlaylistId(link) {
  const uri = link.match(/^spotify:playlist:([a-zA-Z0-9]{22})$/);
  if (uri) return uri[1];

  let url;
  try {
    url = new URL(link);
  } catch {
    throw new Error("Use a Spotify playlist link.");
  }
  const path = url.pathname.match(/^\/(?:intl-[a-zA-Z-]+\/)?playlist\/([a-zA-Z0-9]{22})\/?$/);
  if (url.origin !== "https://open.spotify.com" || !path) {
    throw new Error("Use a Spotify playlist link.");
  }
  return path[1];
}

const PRESET_COUNT = 4; // [NEW] The design has 4 preset buttons

function App() {
  /* ---------- State ----------
     "State" is the stuff the app needs to remember. When any of it changes,
     React redraws the screen to match. */
  const [stations, setStations] = useState(loadStations);
  const [selectedId, setSelectedId] = useState(null); // which station is tuned in
  const [message, setMessage] = useState("");         // little status/error text
  const [loading, setLoading] = useState(false);      // true while adding a station

  // [NEW] Presets: 4 quick-tune buttons. Each slot holds a station id, or null if empty.
  const [presets, setPresets] = useState(() => {
    const saved = loadJSON("friend.fm.presets", []);
    return Array.from({ length: PRESET_COUNT }, (_, i) => saved[i] || null);
  });

  // [NEW] More things to remember:
  const [isPlaying, setIsPlaying] = useState(false);        // is music playing right now?
  const [apiReady, setApiReady] = useState(false);          // has Spotify's player code finished loading?
  const [showAddFriend, setShowAddFriend] = useState(false); // is the Add friend pop-up open?
  // [NEW] Which page we're on: "radio" (the player) or "catalog" (all stations).
  const [view, setView] = useState("radio");
  // [NEW] What's typed in the catalog's search box.
  const [search, setSearch] = useState("");

  // [NEW] Refs. A ref is like a sticky note that React keeps for us. Unlike state,
  // changing a ref does NOT redraw the screen. We use them for things we need to
  // hold on to but that don't change what's displayed.
  const embedRef = useRef(null);       // the empty box where Spotify's player gets placed
  const controllerRef = useRef(null);  // Spotify's remote control (play, pause, switch playlist)
  const creatingRef = useRef(false);   // true while we're still setting up that remote control
  const isPlayingRef = useRef(false);  // a copy of isPlaying that effects can read the latest value of
  const uriRef = useRef("");           // a copy of the current playlist uri, same idea
  isPlayingRef.current = isPlaying;

  /* ---------- Values we work out from the state above ---------- */

  // [CHANGED] We sort the stations by frequency (low to high). Now prev/next and
  // the dial always go in dial order, no matter which friend was added first.
  const sorted = [...stations].sort((a, b) => parseFloat(a.frequency) - parseFloat(b.frequency));

  // The station that's tuned in. If nothing is picked yet, we use the first one.
  const selected = sorted.find(station => station.id === selectedId) || sorted[0];
  const selectedIndex = sorted.findIndex(station => station.id === selected?.id);

  // [NEW] The stations that match the catalog's search box. We look at the friend's
  // name, the playlist title and the frequency, and ignore upper/lower case.
  // An empty search box matches everything.
  const query = search.trim().toLowerCase();
  const filteredStations = sorted.filter(station =>
    !query ||
    station.friend.toLowerCase().includes(query) ||
    station.title.toLowerCase().includes(query) ||
    station.frequency.includes(query)
  );

  // [NEW] The format Spotify's player wants for a playlist, like "spotify:playlist:abc123"
  const uri = selected ? "spotify:playlist:" + selected.playlist : "";
  uriRef.current = uri;

  /* ---------- Saving to the browser ----------
     [NEW] useEffect means "run this after the screen updates". Each one below says:
     "whenever this thing changes, save it." This replaces the old manual save that
     used to live inside addStation. */
  useEffect(() => {
    localStorage.setItem("friend.fm.stations", JSON.stringify(stations));
  }, [stations]);
  useEffect(() => {
    localStorage.setItem("friend.fm.presets", JSON.stringify(presets));
  }, [presets]);
  /* ---------- The Spotify player (this is how play/pause works) ----------
     Before, we just dropped in a plain <iframe>. That shows Spotify's player, but
     we can't press its buttons from our code. Spotify offers a small script that
     gives us a "remote control" for the player, so now we use that. */

  // [NEW] Step 1: load Spotify's script. When it's ready, it calls the function
  // below, and we flip apiReady to true. We add the script from here so we don't
  // have to edit index.html.
  useEffect(() => {
    if (window.__spotifyIFrameAPI) {
      setApiReady(true);
      return;
    }
    window.onSpotifyIframeApiReady = IFrameAPI => {
      window.__spotifyIFrameAPI = IFrameAPI;
      setApiReady(true);
    };
    const script = document.createElement("script");
    script.src = "https://open.spotify.com/embed/iframe-api/v1";
    script.async = true;
    document.body.appendChild(script);
  }, []);

  // [NEW] Step 2: once Spotify's script is ready and we have a station, either
  // create the player (the first time) or switch it to the new playlist (every
  // time after that). This re-runs whenever the playlist changes.
  useEffect(() => {
    if (!apiReady || !selected) return;

    // The player already exists, so just load the new station into it.
    // If the radio was playing, keep it playing on the new channel.
    if (controllerRef.current) {
      controllerRef.current.loadUri(uri);
      if (isPlayingRef.current) controllerRef.current.play();
      return;
    }

    // Setting up the player takes a moment. This stops us from starting it twice.
    if (creatingRef.current) return;
    creatingRef.current = true;

    // Spotify swaps out the element we give it for its own iframe. So we make a
    // fresh blank <div> for it to take over, which keeps React out of its way.
    const host = document.createElement("div");
    embedRef.current.replaceChildren(host);
    window.__spotifyIFrameAPI.createController(
      host,
      { uri, width: "100%", height: 352, theme: 0 },
      controller => {
        // The player is ready. Keep the remote control so other functions can use it.
        controllerRef.current = controller;
        creatingRef.current = false;

        // Spotify tells us whenever it starts or stops playing. We listen so our
        // Play/Pause button and ON AIR light stay correct even if someone clicks
        // the play button inside Spotify's own player.
        controller.addListener("playback_update", event => {
          setIsPlaying(!event.data.isPaused);
        });

        // The user may have changed station while the player was still loading.
        // If so, catch up now.
        if (uriRef.current !== uri) controller.loadUri(uriRef.current);
        if (isPlayingRef.current) controller.play();
      }
    );
  }, [apiReady, uri]);

  /* ---------- Actions (what each button does) ---------- */

  // Go to the previous (-1) or next (+1) station. At either end it wraps around:
  // after the last station you land on the first, and the other way too.
  // [CHANGED] Now uses the sorted list, so it follows the dial order.
  function changeChannel(step) {
    if (sorted.length === 0) return;
    const nextIndex = (selectedIndex + step + sorted.length) % sorted.length;
    setSelectedId(sorted[nextIndex].id);
  }

  // [NEW] Play/Pause button. We tell Spotify to toggle, and we also flip our own
  // isPlaying right away so the button feels instant. (Spotify's update listener
  // above fixes it if we ever guess wrong.)
  function togglePlay() {
    if (!controllerRef.current) return;
    controllerRef.current.togglePlay();
    setIsPlaying(playing => !playing);
  }

  // [CHANGED] Used by the "Tune in" buttons in the catalog: tune to that station,
  // start playing, and go back to the radio page so you can see it.
  function tuneAndPlay(id) {
    setIsPlaying(true);
    setSelectedId(id);
    setView("radio");
    // If we're already on this station, nothing changes, so the player effect
    // above won't run. In that case we press play ourselves.
    if (id === selected?.id && controllerRef.current) controllerRef.current.play();
  }

  // [NEW] Pressing a preset button. Two cases:
  //  - Slot has a station: tune to it.
  //  - Slot is empty: save the station we're listening to into that slot.
  function pressPreset(slot) {
    const stationId = presets[slot];
    if (stationId) {
      if (stations.some(station => station.id === stationId)) setSelectedId(stationId);
    } else if (selected) {
      setPresets(current => current.map((item, i) => (i === slot ? selected.id : item)));
    }
  }

  // [NEW] The little × next to a preset: empties that slot.
  function clearPreset(slot) {
    setPresets(current => current.map((item, i) => (i === slot ? null : item)));
  }

  // Runs when someone submits the "Add friend" form.
  // [CHANGED] What's different from before:
  //  - the station now gets a fixed frequency
  //  - saving to the browser happens automatically (see the save effects above)
  async function addStation(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setLoading(true);
    setMessage("");

    try {
      const friend = data.get("friend").trim();
      if (!friend) throw new Error("Enter your friend’s name.");
      const playlist = getPlaylistId(data.get("playlist").trim());
      const link = "https://open.spotify.com/playlist/" + playlist;

      // Ask Spotify for the playlist's title and artwork.
      let response;
      try {
        response = await fetch(
          "https://open.spotify.com/oembed?url=" + encodeURIComponent(link),
          { signal: AbortSignal.timeout(10000) }
        );
      } catch {
        throw new Error("Couldn’t reach Spotify. Check your connection and try again.");
      }
      if (!response.ok) throw new Error("Couldn’t load the playlist. Check that it’s public.");
      const metadata = await response.json();
      if (!metadata.title) throw new Error("Spotify returned no playlist title.");

      const id = friend.toLowerCase() + ":" + playlist;
      const existing = stations.find(item => item.id === id);
      const station = {
        id,
        friend,
        playlist,
        title: metadata.title,
        artwork: metadata.thumbnail_url || "",
        // [NEW] If this friend + playlist was added before, keep its old frequency.
        // Otherwise pick a new fixed one.
        frequency:
          existing?.frequency ||
          assignFrequency(id, new Set(stations.map(item => item.frequency)))
      };
      const updated = [...stations];
      const index = updated.findIndex(item => item.id === station.id);
      if (index === -1) updated.push(station);
      else updated[index] = station;

      setStations(updated);
      setSelectedId(station.id);
      setMessage("Station saved.");
      setSearch(""); // [NEW] clear the catalog search so the new station isn't hidden by it
      form.reset();
      setShowAddFriend(false); // [NEW] close the pop-up
    } catch (error) {
      setMessage(error.message || "Couldn’t add the station. Try again.");
    } finally {
      setLoading(false);
    }
  }

  /* ---------- What shows on the screen ----------
     This part looks like HTML, but it's JSX. The bits in { curly braces } are
     JavaScript, which is how we show our state and connect buttons to actions. */
  return (
    <main>
      {/* [CHANGED] The header now matches the design: title, Catalog, Add friend, Me.
          The Favorites button that used to be here is gone, and a Catalog button
          took its place. */}
      <header className="topbar">
        <h1>FRIEND FM</h1>
        <div className="topbar-actions">
          {/* [NEW] Switches between the radio page and the catalog page. The label
              always says where the button will take you. */}
          <button type="button" onClick={() => setView(current => (current === "radio" ? "catalog" : "radio"))}>
            {view === "radio" ? "Catalog (" + stations.length + ")" : "◀ Back to radio"}
          </button>
          <button type="button" onClick={() => { setMessage(""); setShowAddFriend(true); }}>
            + Add friend
          </button>
          {/* [TODO] The design has a "Me" button, but we don't know yet what it should
              open (profile? settings?). It does nothing for now, so the team can
              decide what goes here. */}
          <button type="button" className="me">Me</button>
        </div>
      </header>

      {/* [NEW] The Add friend form now opens as a pop-up window. Before, it sat on
          the page all the time. Clicking the dark background outside it closes it. */}
      {showAddFriend && (
        <div className="modal-backdrop" onClick={() => setShowAddFriend(false)}>
          <form role="dialog" aria-modal="true" aria-labelledby="add-friend-title"
            className="modal" onSubmit={addStation} onClick={e => e.stopPropagation()}>
            <h2 id="add-friend-title">Add friend</h2>
            <p>
              <label>
                Friend’s name
                <input name="friend" required maxLength={60} autoFocus />
              </label>
            </p>
            <p>
              <label>
                Spotify playlist link
                <input name="playlist" required spellCheck={false} autoCapitalize="none" />
              </label>
            </p>
            <p role="status">{message}</p>
            <button disabled={loading}>{loading ? "Adding…" : "Add station"}</button>
            <button type="button" onClick={() => setShowAddFriend(false)}>Cancel</button>
          </form>
        </div>
      )}

      {/* When the pop-up is closed, still show messages like "Station saved." */}
      {!showAddFriend && <p role="status">{message}</p>}

      {stations.length === 0 && <p>No stations yet. Use “+ Add friend” to tune in your first one.</p>}

      {/* The radio itself. It only shows up once there's at least one station.
          [CHANGED] It stays on the page even while you're looking at the catalog; we
          just hide it (the "hidden" part). That way Spotify's player isn't thrown
          away, and your music keeps playing while you browse. */}
      {selected && (
        <section className="radio" aria-label="Radio player" hidden={view !== "radio"}>
          {/* [NEW] The ON AIR light: on while music is playing */}
          <p className="on-air">{isPlaying ? "● ON AIR" : "○ OFF AIR"}</p>

          {/* The display: artwork, whose playlist it is, frequency, and what's on */}
          {selected.artwork && <img src={selected.artwork} alt="" width="64" height="64" />}
          <h2>{selected.friend}’s playlist</h2>
          {/* [CHANGED] The frequency now comes from the station itself */}
          <p className="frequency">FM {selected.frequency} MHz</p>
          {/* [TODO] The design shows "[Song title] — [Artist]" here, but Spotify's
              player doesn't tell us which song is playing. For now we show the
              playlist name instead. Showing the real song would need the Spotify
              Web API and a login. */}
          <p className="now-playing">♪ {selected.title}</p>

          {/* The dial: one tick for each station, in frequency order. Clicking a
              tick tunes to that station. */}
          <div className="ticks">
            {sorted.map(station => (
              <button key={station.id} type="button" className="tick"
                onClick={() => setSelectedId(station.id)}
                aria-label={station.frequency + " MHz, " + station.friend + "’s station"}
                aria-current={station.id === selected.id ? "true" : undefined}>
                <span className="tick-bar" aria-hidden="true"></span>
                <span className="tick-label">{station.frequency}</span>
              </button>
            ))}
          </div>

          {/* The main buttons: previous, play/pause, next */}
          <div className="controls">
            <button type="button" onClick={() => changeChannel(-1)} disabled={sorted.length < 2}
              aria-label="Previous channel">
              ◀ Previous channel
            </button>
            {/* [NEW] Play/Pause. It's disabled until Spotify's player has loaded. */}
            <button type="button" onClick={togglePlay} disabled={!apiReady}
              aria-pressed={isPlaying} aria-label={isPlaying ? "Pause" : "Play"}>
              {isPlaying ? "❚❚ Pause" : "▶ Play"}
            </button>
            <button type="button" onClick={() => changeChannel(1)} disabled={sorted.length < 2}
              aria-label="Next channel">
              Next channel ▶
            </button>
          </div>
          <span> {selectedIndex + 1} / {sorted.length} </span>

          {/* [NEW] Presets: an empty slot saves the station you're on, a filled slot
              tunes to its station. The × clears a slot. */}
          <div className="presets">
            <span>Presets</span>
            {presets.map((stationId, slot) => {
              const station = stations.find(item => item.id === stationId);
              return (
                <span key={slot} className="preset">
                  <button type="button" onClick={() => pressPreset(slot)}
                    aria-label={station
                      ? "Tune to preset " + (slot + 1) + ", " + station.friend
                      : "Save current station to preset " + (slot + 1)}>
                    {station ? station.frequency + " " + station.friend : (slot + 1) + " · Empty"}
                  </button>
                  {station && (
                    <button type="button" onClick={() => clearPreset(slot)}
                      aria-label={"Clear preset " + (slot + 1)}>×</button>
                  )}
                </span>
              );
            })}
          </div>

          {/* [CHANGED] Spotify's player goes inside this empty box. The code up above
              creates it (instead of a plain <iframe>), which is what lets us control
              play and pause. */}
          <div ref={embedRef} className="embed" />
          <a href={"https://open.spotify.com/playlist/" + selected.playlist}>Open in Spotify</a>
        </section>
      )}

      {/* [NEW] The catalog page: every station in one place, with a search box.
          It only shows while view is "catalog". */}
      {view === "catalog" && (
        <section className="catalog" aria-labelledby="catalog-title">
          <h2 id="catalog-title">Station catalog</h2>

          {/* Nothing added yet: explain what to do. This is the starting screen for a new user. */}
          {stations.length === 0 ? (
            <div className="catalog-empty">
              <p>No stations yet. Add a friend’s Spotify playlist to start your radio.</p>
              <button type="button" onClick={() => { setMessage(""); setShowAddFriend(true); }}>
                + Add friend
              </button>
            </div>
          ) : (
            <>
              <label className="catalog-search">
                <span>Search friends</span>
                <input type="search" value={search} placeholder="Friend, playlist or frequency"
                  onChange={event => setSearch(event.target.value)} />
              </label>
              {/* aria-live makes screen readers announce the count when the search changes */}
              <p className="catalog-count" aria-live="polite">
                {filteredStations.length} of {stations.length} station{stations.length === 1 ? "" : "s"}
              </p>

              {filteredStations.length === 0 && (
                <p className="catalog-none">No stations match “{search.trim()}”.</p>
              )}

              <ul className="catalog-list">
                {filteredStations.map(station => {
                  const presetSlot = presets.indexOf(station.id); // -1 means not saved as a preset
                  const isTuned = station.id === selected?.id;
                  return (
                    <li key={station.id} className={isTuned ? "catalog-item is-tuned" : "catalog-item"}>
                      {station.artwork
                        ? <img src={station.artwork} alt="" width="56" height="56" />
                        : <span className="catalog-art-empty" aria-hidden="true">♪</span>}
                      <div className="catalog-info">
                        <strong>{station.friend}’s playlist</strong>
                        <div className="catalog-freq">FM {station.frequency} MHz</div>
                        <div className="catalog-title">{station.title}</div>
                        <div className="catalog-badges">
                          {isTuned && <span className="badge">{isPlaying ? "On air" : "Tuned in"}</span>}
                          {presetSlot !== -1 && <span className="badge">Preset {presetSlot + 1}</span>}
                        </div>
                      </div>
                      <div className="catalog-actions">
                        <button type="button" onClick={() => tuneAndPlay(station.id)}
                          aria-label={"Tune in to " + station.friend + "’s playlist"}>
                          ▶ Tune in
                        </button>
                        <a href={"https://open.spotify.com/playlist/" + station.playlist}
                          target="_blank" rel="noreferrer">
                          Open in Spotify
                        </a>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}

      {/* [CHANGED] The big "Stations" button list from the original is gone. The dial,
          prev/next and the catalog now handle finding and tuning stations. */}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
