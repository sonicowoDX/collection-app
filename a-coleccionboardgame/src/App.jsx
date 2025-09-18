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

  // Guardar o actualizar voto
  async function handleVote(objectid, v) {
    if (!username) return;

    setVotes((prev) => ({
      ...prev,
      [objectid]: { ...prev[objectid], [username]: v }
    }));

    // Si ya existe voto de este usuario, actualizar
    await supabase.from("votes").upsert({
      collection_code: collectionCode,
      objectid,
      username,
      vote: v
    });

    await loadVotersList();
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
        const code = randomCollectionCode();
        setCollectionCode(code);
        setOwner(username);

        await supabase.from("collections").insert({
          collection_code: code,
          owner: username
        });

        const gamesData = rows.map((r) => {
          const objectid = r.objectid;
          const slug = r.originalname
            ? r.originalname.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
            : r.objectname.toLowerCase().replace(/\s+/g, "-");
          const type = r.itemtype?.includes("expansion") ? "boardgameexpansion" : "boardgame";
          return {
            collection_code: code,
            objectid,
            objectname: r.objectname,
            originalname: r.originalname,
            itemtype: r.itemtype,
            comment: r.comment,
            image_link: `https://boardgamegeek.com/${type}/${objectid}/${slug}`
          };
        });

        await supabase.from("games").insert(gamesData);
        setGames(gamesData);
        await loadVotersList();
      }
    });
  }

  // Cargar colección desde Supabase
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

  // Cargar todos los votos de la colección
  async function loadVotes() {
    if (!collectionCode) return;
    const { data } = await supabase
      .from("votes")
      .select("*")
      .eq("collection_code", collectionCode);

    const votesMap = {};
    data?.forEach((v) => {
      if (!votesMap[v.objectid]) votesMap[v.objectid] = {};
      votesMap[v.objectid][v.username] = v.vote;
    });

    setVotes(votesMap);
  }

  // Obtener lista de votantes únicos
  async function loadVotersList() {
    const { data } = await supabase
      .from("votes")
      .select("username")
      .eq("collection_code", collectionCode);
    const uniqueUsers = [...new Set(data?.map((v) => v.username))];
    setVotersList(uniqueUsers);
  }

  // Filtrado derivado dinámico
  function getFilteredGames() {
    if (filterUsers.length === 0) return games;

    const filtered = games.map((g) => {
      const gameVotes = votes[g.objectid] || {};
      const count = filterUsers.reduce((acc, user) => acc + (gameVotes[user] === 1 ? 1 : 0), 0);
      return { ...g, likesCount: count };
    });

    return filtered
      .filter(g => g.likesCount > 0)
      .sort((a, b) => b.likesCount - a.likesCount);
  }

  // =====================
  // RENDER
  // =====================

  // Pedir usuario antes de mostrar nada
  if (!username) {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", flexDirection: "column", fontFamily: "Arial, sans-serif" }}>
        <h2>Bienvenido 🎲</h2>
        <p>Ingresa tu nombre o apodo para continuar:</p>
        <input
          placeholder="Tu nombre/apodo"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{ padding: "10px", fontSize: "16px" }}
        />
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "Arial, sans-serif", padding: "10px" }}>
      <h1 style={{ textAlign: "center" }}>🎲 Colección de Juegos</h1>

      <div style={{ margin: "20px 0", textAlign: "center" }}>
        <h2>Subir colección</h2>
        <input
          type="file"
          accept=".csv"
          onChange={handleUploadCSV}
          style={{ cursor: "pointer" }}
        />
      </div>

      <h2>Unirse a colección</h2>
      <input
        placeholder="Código de colección"
        value={collectionCode}
        onChange={(e) => setCollectionCode(e.target.value.toUpperCase())}
      />
      <button onClick={loadCollection}>Cargar colección</button>

      <h2>Filtrar por usuarios</h2>
      <div style={{ marginBottom: "10px" }}>
        {votersList.map((user) => (
          <label key={user} style={{ marginRight: "10px" }}>
            <input
              type="checkbox"
              checked={filterUsers.includes(user)}
              onChange={(e) => {
                if (e.target.checked) {
                  setFilterUsers(prev => [...prev, user]);
                } else {
                  setFilterUsers(prev => prev.filter(u => u !== user));
                }
              }}
            />
            {user}
          </label>
        ))}
      </div>

      {/* Grid de tarjetas */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
        gap: "15px"
      }}>
        {getFilteredGames().map((g) => {
          const userVote = votes[g.objectid]?.[username] || 0;
          return (
            <div key={g.objectid} style={{
              border: "1px solid #ccc",
              borderRadius: "10px",
              padding: "15px",
              background: "#f9f9f9",
              boxShadow: "2px 2px 6px rgba(0,0,0,0.1)"
            }}>
              <h3>
                <a href={g.image_link} target="_blank" rel="noreferrer">
                  {g.objectname}
                </a>
              </h3>
              <p><b>Original:</b> {g.originalname}</p>
              <p><b>Tipo:</b> {g.itemtype}</p>
              <p><b>Comentario:</b> {g.comment}</p>

              {filterUsers.length === 0 ? (
                <div>
                  <button
                    onClick={() => handleVote(g.objectid, 1)}
                    style={{
                      background: userVote === 1 ? "green" : "#ddd",
                      color: userVote === 1 ? "white" : "black",
                      marginRight: "10px",
                      padding: "5px 10px",
                      borderRadius: "5px"
                    }}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => handleVote(g.objectid, -1)}
                    style={{
                      background: userVote === -1 ? "red" : "#ddd",
                      color: userVote === -1 ? "white" : "black",
                      padding: "5px 10px",
                      borderRadius: "5px"
                    }}
                  >
                    👎
                  </button>
                </div>
              ) : (
                <p>{g.likesCount} 👍</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
