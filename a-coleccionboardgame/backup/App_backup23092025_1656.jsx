import React, { useState, useEffect } from "react";
import Papa from "papaparse";
import { supabase } from "./lib/supabaseClient";

function randomCollectionCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

export default function App() {
  const [username, setUsername] = useState("");
  const [collectionCode, setCollectionCode] = useState("");
  const [owner, setOwner] = useState("");
  const [games, setGames] = useState([]);
  const [votes, setVotes] = useState({});
  const [filterUsers, setFilterUsers] = useState([]);
  const [votersList, setVotersList] = useState([]);
  const [isUserConfirmed, setIsUserConfirmed] = useState(false);

  // 🔹 Nuevo: control de orden y tipo
  const [sortOption, setSortOption] = useState("name");
  const [filterType, setFilterType] = useState("all");

  // Guardar o actualizar voto
  async function handleVote(gameId, objectid, v) {
    if (!username) return;

    let existingFavorite = false;

    setVotes((prev) => {
      existingFavorite = prev[objectid]?.[username]?.favorite ?? false;

      const updatedVotes = {
        ...prev,
        [objectid]: {
          ...prev[objectid],
          [username]: {
            vote: v,
            favorite: existingFavorite
          }
        }
      };

      return updatedVotes;
    });

    console.log("handleVote llamado con:", { collectionCode, username, objectid, v, existingFavorite });

    // 🔹 Ahora sí, hacemos el upsert fuera del setVotes
    const { error } = await supabase.from("votes").upsert(
      {
        collection_code: collectionCode,
        objectid,
        username,
        vote: v,
        favorite: existingFavorite
      },
      { onConflict: "collection_code,objectid,username" }
    );

    if (error) {
      console.error("Error en upsert de votos:", error);
    }

    await loadVotersList();
  }

  // Marcar o desmarcar favorito
  async function handleFavorite(objectid, currentFavorite) {
    if (!username) return;
    const existingVote = votes[objectid]?.[username]?.vote ?? 0;
    let newFavorite;
    if (!currentFavorite) {
      newFavorite = true;
    } else {
      newFavorite = false;
    }
    setVotes((prev) => ({
      ...prev,
      [objectid]: {
        ...prev[objectid],
        [username]: {
          vote: prev[objectid]?.[username]?.vote ?? 0,
          favorite: !currentFavorite
        }
      }
    }));
    await supabase.from("votes").upsert(
        {
          collection_code: collectionCode,
          objectid,
          username,
          vote: existingVote,
          favorite: newFavorite
        },
        { onConflict: "collection_code,objectid,username" } 
      );
  }


  // Subir colección
  async function handleUploadCSV(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!username) {
      alert("Ingresa tu nombre/apodo antes de subir la colección");
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data;

        // Verificar si el usuario ya tiene colección
        const { data: existingCollection } = await supabase
          .from("collections")
          .select("collection_code")
          .eq("owner", username)
          .single();

        let code;
        if (existingCollection) {
          code = existingCollection.collection_code;
          setCollectionCode(code);
          setOwner(username);

          const { data: existingGames } = await supabase
            .from("games")
            .select("objectid")
            .eq("collection_code", code);

          const existingIds = new Set(existingGames.map((g) => g.objectid));
          const newGames = rows.filter((r) => !existingIds.has(r.objectid));

          if (newGames.length === 0) {
            alert("Tu colección ya está actualizada, no hay juegos nuevos.");
            return;
          }

          const gamesData = await Promise.all(
            newGames.map(async (r) => {
              const objectid = r.objectid;
              const slug = r.originalname
                ? r.originalname
                    .toLowerCase()
                    .replace(/\s+/g, "-")
                    .replace(/[^a-z0-9-]/g, "")
                : r.objectname.toLowerCase().replace(/\s+/g, "-");
              const type = r.itemtype?.includes("expansion")
                ? "boardgameexpansion"
                : "boardgame";

              const image_link = await getBGGImage(objectid);

              return {
                collection_code: code,
                objectid,
                objectname: r.objectname,
                originalname: r.originalname,
                itemtype: r.itemtype,
                comment: r.comment,
                image_link,
                link_bgg: `https://boardgamegeek.com/${type}/${objectid}/${slug}`
              };
            })
          );

          await supabase.from("games").insert(gamesData);
          setGames((prev) => [...prev, ...gamesData]);
        } else {
          code = randomCollectionCode();
          setCollectionCode(code);
          setOwner(username);

          await supabase.from("collections").insert({
            collection_code: code,
            owner: username
          });

          const gamesData = await Promise.all(
            rows.map(async (r) => {
              const objectid = r.objectid;
              const slug = r.originalname
                ? r.originalname
                    .toLowerCase()
                    .replace(/\s+/g, "-")
                    .replace(/[^a-z0-9-]/g, "")
                : r.objectname.toLowerCase().replace(/\s+/g, "-");
              const type = r.itemtype?.includes("expansion")
                ? "boardgameexpansion"
                : "boardgame";

              const image_link = await getBGGImage(objectid);

              return {
                collection_code: code,
                objectid,
                objectname: r.objectname,
                originalname: r.originalname,
                itemtype: r.itemtype,
                comment: r.comment,
                image_link,
                link_bgg: `https://boardgamegeek.com/${type}/${objectid}/${slug}`
              };
            })
          );

          await supabase.from("games").insert(gamesData);
          setGames(gamesData);
        }

        await loadVotersList();
      }
    });
  }

  // Cargar colección
  async function loadCollection() {
    if (!collectionCode) return;
    const { data: gamesData } = await supabase
      .from("games")
      .select("*")
      .eq("collection_code", collectionCode);
    setGames(gamesData || []);
    await loadVotes();
    await loadVotersList();
  }

  // Cargar votos (incluyendo favorite)
    async function loadVotes() {
      if (!collectionCode) return;
      const { data } = await supabase
        .from("votes")
        .select("*")
        .eq("collection_code", collectionCode);
  
      const votesMap = {};
      data?.forEach((v) => {
        if (!votesMap[v.objectid]) votesMap[v.objectid] = {};
        votesMap[v.objectid][v.username] = {
          vote: v.vote ?? 0,
          favorite: v.favorite ?? false
        };
      });

  
      setVotes(votesMap);
    }

  // Lista de votantes
  async function loadVotersList() {
    const { data } = await supabase
      .from("votes")
      .select("username")
      .eq("collection_code", collectionCode);
    const uniqueUsers = [...new Set(data?.map((v) => v.username))];
    setVotersList(uniqueUsers);
  }

  // Filtro dinámico con conteos
  function getFilteredGames() {
    let list = games.map((g) => {
      const gameVotes = votes[g.objectid] || {};
      let likes = 0,
        dislikes = 0,
        neutrals = 0,
        notPlayed = 0;

      const voters = [];

      votersList.forEach((user) => {
        const v = gameVotes[user];
        if (v === 1) likes++;
        else if (v === -1) dislikes++;
        else if (v === 0) neutrals++;
        else if (v === -2) notPlayed++;
        if (v !== undefined) voters.push(user);
      });

      return { ...g, likes, dislikes, neutrals, notPlayed, voters };
    });

    if (filterType === "base") {
      list = list.filter((g) => g.itemtype === "boardgame");
    } else if (filterType === "expansion") {
      list = list.filter((g) => g.itemtype.includes("expansion"));
    }

    if (sortOption === "name") {
      list.sort((a, b) => a.objectname.localeCompare(b.objectname));
    } else if (sortOption === "votes") {
      list.sort((a, b) => b.likes - a.likes);
    }

    return list;
  }

  async function getBGGImage(objectid) {
    try {
      const res = await fetch(
        `https://www.boardgamegeek.com/xmlapi2/thing?id=${objectid}`
      );
      const text = await res.text();
      const parser = new DOMParser();
      const xml = parser.parseFromString(text, "text/xml");
      const image = xml.querySelector("image")?.textContent;
      return image || "ruta/a/imagen/default.png";
    } catch (err) {
      console.error("Error fetching BGG image:", err);
      return "ruta/a/imagen/default.png";
    }
  }

  async function checkUserCollection(user) {
    const { data: collectionsData } = await supabase
      .from("collections")
      .select("*")
      .eq("owner", user)
      .limit(1);

    if (collectionsData?.length > 0) {
      const collection = collectionsData[0];
      setCollectionCode(collection.collection_code);
      setOwner(user);
      setIsUserConfirmed(true);
      await loadCollection();
    } else {
      setIsUserConfirmed(true);
    }
  }

  // ===================== RENDER =====================

  if (!isUserConfirmed) {
    return (
      <div style={{ textAlign: "center", marginTop: "50px" }}>
        <h2>👤 Ingresa tu nombre/apodo 👤</h2>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === "Enter" && username.trim() !== "") {
              await checkUserCollection(username.trim());
            }
          }}
        />
        <br />
        <br />
        <button
          onClick={async () => {
            if (username.trim() !== "") await checkUserCollection(username.trim());
          }}
        >
          Confirmar
        </button>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "Arial, sans-serif", padding: "10px", textAlign: "center" }}>
      <h1>🎲 Colección de Juegos</h1>

      <div style={{ margin: "20px 0" }}>
        <h2>Subir colección (CSV exportado de la BGG)</h2>
        <input type="file" accept=".csv" onChange={handleUploadCSV} />
      </div>

      <h2>Unirse a colección</h2>
      <input
        placeholder="Código de colección"
        value={collectionCode}
        onChange={(e) => setCollectionCode(e.target.value.toUpperCase())}
      />
      <br />
      <br />
      <button onClick={loadCollection}>Cargar colección</button>

      <h2>Filtrar por usuarios</h2>
      <div>
        {votersList.map((user) => (
          <label key={user} style={{ marginRight: "10px" }}>
            <input
              type="checkbox"
              checked={filterUsers.includes(user)}
              onChange={(e) => {
                if (e.target.checked) {
                  setFilterUsers((prev) => [...prev, user]);
                } else {
                  setFilterUsers((prev) => prev.filter((u) => u !== user));
                }
              }}
            />
            {user}
          </label>
        ))}
      </div>

      {/* 🔹 Nuevo: opciones de orden y filtro */}
      <div style={{ margin: "15px 0" }}>
        <label>
          Ordenar por:{" "}
          <select value={sortOption} onChange={(e) => setSortOption(e.target.value)}>
            <option value="name">Nombre</option>
            <option value="votes">Número de votos</option>
          </select>
        </label>
        {" | "}
        <label>
          Tipo:{" "}
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="all">Todos</option>
            <option value="standalone">Solo juegos base</option>
            <option value="expansion">Solo expansiones</option>
          </select>
        </label>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
          gap: "15px",
          marginTop: "20px"
        }}
      >
        {getFilteredGames().map((g) => {
          const userVoteObj = votes[g.objectid]?.[username] ?? { vote: null, favorite: false };
          const userVote = userVoteObj.vote;
          const userFavorite = userVoteObj.favorite;

          return (
            <div
              key={g.id}
              style={{
                position: "relative",
                border: "1px solid #4b4b4bff",
                borderRadius: "10px",
                padding: "15px",
                background: "#00000088"
              }}
            >
              {/* ⭐ favorito */}
              <button
                onClick={() => handleFavorite(g.objectid, userFavorite)}
                style={{
                  position: "absolute",
                  top: "10px",
                  right: "10px",
                  background: userFavorite ? "gold" : "#363636e1",
                  color: "black",
                  border: "none",
                  borderRadius: "50%",
                  width: "30px",
                  height: "30px",
                  cursor: "pointer",
                  padding: "0%"
                }}
              >
              ⭐
              </button>

              <img
                src={g.image_link}
                alt={g.objectname}
                style={{
                  width: "100%",
                  height: "auto",
                  borderRadius: "6px",
                  marginBottom: "10px"
                }}
              />
              <h3>
                <a href={g.link_bgg} target="_blank" rel="noreferrer">
                  {g.objectname}
                </a>
              </h3>
              <p><b>Original:</b> {g.originalname}</p>
              <p><b>Tipo:</b> {g.itemtype}</p>
              <p><b>Comentario:</b> {g.comment}</p>

              {filterUsers.length === 0 ? (
                <div>
                  <button
                    onClick={() => handleVote(g.id, g.objectid, 1)}
                    style={{
                      background: userVote === 1 ? "green" : "#36363679",
                      color: "white",
                      marginRight: "5px"
                    }}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => handleVote(g.id, g.objectid, 0)}
                    style={{
                      background: userVote === 0 ? "gray" : "#36363679",
                      color: "white",
                      marginRight: "5px"
                    }}
                  >
                    😐
                  </button>
                  <button
                    onClick={() => handleVote(g.id, g.objectid, -1)}
                    style={{
                      background: userVote === -1 ? "red" : "#36363679",
                      color: "white",
                      marginRight: "5px"
                    }}
                  >
                    👎
                  </button>
                  <br />
                  <button
                    onClick={() => handleVote(g.id, g.objectid, -2)}
                    style={{
                      background: userVote === -2 ? "purple" : "#36363679",
                      color: "white",
                      marginTop: "5px"
                    }}
                  >
                    ❌ No Jugado
                  </button>
                </div>
              ) : (
                <p title={g.voters?.join(", ")}>
                  👍 {g.likes || 0} | 👎 {g.dislikes || 0} | 😐 {g.neutrals || 0} | ❌{" "}
                  {g.notPlayed || 0}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
