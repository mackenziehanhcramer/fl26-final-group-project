import React, { useState } from "react";
import { createRoot } from "react-dom/client";

function loadStations() {
  try {
    const saved = JSON.parse(localStorage.getItem("friend.fm.stations") || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function getPlaylistId(link) {
  const uri = link.match(/^spotify:playlist:([a-zA-Z0-9]{22})$/);
  if (uri) return uri[1];

  const url = new URL(link);
  const path = url.pathname.match(/^\/(?:intl-[a-zA-Z-]+\/)?playlist\/([a-zA-Z0-9]{22})\/?$/);
  if (url.origin !== "https://open.spotify.com" || !path) {
    throw new Error("Use a Spotify playlist link.");
  }
  return path[1];
}

// Spread the stations evenly across the FM dial (88.1 – 107.9 MHz).
function frequency(index, count) {
  const step = count > 1 ? 19.8 / (count - 1) : 0;
  return (88.1 + index * step).toFixed(1);
}

function App() {
  const [stations, setStations] = useState(loadStations);
  const [selectedId, setSelectedId] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const selected = stations.find(station => station.id === selectedId) || stations[0];
  const selectedIndex = stations.findIndex(station => station.id === selected?.id);

  // Move to the previous (-1) or next (+1) station, wrapping around at the ends.
  function changeChannel(step) {
    if (stations.length === 0) return;
    const nextIndex = (selectedIndex + step + stations.length) % stations.length;
    setSelectedId(stations[nextIndex].id);
  }

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

      // Ask Spotify for the playlist title and artwork.
      const response = await fetch(
        "https://open.spotify.com/oembed?url=" + encodeURIComponent(link),
        { signal: AbortSignal.timeout(10000) }
      );
      if (!response.ok) throw new Error("Couldn’t load the playlist. Check that it’s public.");
      const metadata = await response.json();
      if (!metadata.title) throw new Error("Spotify returned no playlist title.");

      const station = {
        id: friend.toLowerCase() + ":" + playlist,
        friend,
        playlist,
        title: metadata.title,
        artwork: metadata.thumbnail_url || ""
      };
      const updated = [...stations];
      const index = updated.findIndex(item => item.id === station.id);
      if (index === -1) updated.push(station);
      else updated[index] = station;

      // Keep the stations after a page refresh.
      localStorage.setItem("friend.fm.stations", JSON.stringify(updated));
      setStations(updated);
      setSelectedId(station.id);
      setMessage("Station saved.");
      form.reset();
    } catch (error) {
      setMessage(error.message || "Couldn’t add the station. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>friend.fm</h1>
      <form onSubmit={addStation}>
        <p>
        <label>
          Friend’s name
          <input name="friend" required maxLength={60} />
        </label>
        </p>
        <p>
        <label>
          Spotify playlist link
          <input name="playlist" required spellCheck={false} autoCapitalize="none" />
        </label>
        </p>
        <button disabled={loading}>{loading ? "Adding…" : "Add station"}</button>
      </form>
      <p role="status">{message}</p>

      <h2>Stations</h2>
      {stations.length === 0 && <p>No stations yet.</p>}
      <div id="stations">
        {stations.map(station => (
          <button key={station.id} onClick={() => setSelectedId(station.id)}
            aria-pressed={station.id === selected?.id}>
            {station.artwork && <img src={station.artwork} alt="" width="48" height="48" />}
            {station.friend} — {station.title}
          </button>
        ))}
      </div>

      {selected && (
        <section>
          <h2>{selected.friend}’s station</h2>
          <div>
            <button type="button" onClick={() => changeChannel(-1)} disabled={stations.length < 2}>
              ◀ Previous channel
            </button>
            <span> {selectedIndex + 1} / {stations.length} </span>
            <button type="button" onClick={() => changeChannel(1)} disabled={stations.length < 2}>
              Next channel ▶
            </button>
          </div>
          <p>FM {frequency(selectedIndex, stations.length)} MHz</p>
          <div className="ticks">
            {stations.map((station, index) => (
              <button key={station.id} type="button" className="tick"
                onClick={() => setSelectedId(station.id)}
                aria-label={frequency(index, stations.length) + " MHz, " + station.friend + "’s station"}
                aria-current={station.id === selected.id ? "true" : undefined}>
                <span className="tick-bar" aria-hidden="true"></span>
                <span className="tick-label">{frequency(index, stations.length)}</span>
              </button>
            ))}
          </div>
          <iframe title={selected.title} height="352"
            src={"https://open.spotify.com/embed/playlist/" + selected.playlist + "?theme=0"}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture" />
          <a href={"https://open.spotify.com/playlist/" + selected.playlist}>Open in Spotify</a>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
