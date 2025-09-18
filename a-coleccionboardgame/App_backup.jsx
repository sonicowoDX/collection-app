import React, { useState, useEffect } from "react";
import Papa from "papaparse";
import { supabase } from "./lib/supabaseClient";

function randomCollectionCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

export default function App() {
  const [username, setUsername] = useState(""); // un solo campo
  const [collectionCode, setCollectionCode] = useState("");
  const [owner, setOwner] = useState(""); 
  const [games, setGames] = useState([]);
  const [votes, setVotes] = useState({});
  const [filterUsers, setFilterUsers] = useState([]);
  const [votersList, setVotersList] = useState([]);

  // Guardar voto en Supabase
  async function handleVote(objectid, v) {
    if (!username) {
      alert("Debes ingresar un nombre o apodo antes de votar.");
      return;
    }

    setVotes((prev) => ({
      ...prev,
      [objectid]: { ...prev[objectid], [username]: v }
    }));

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
    if (filterUsers.length === 0) return games; // Sin filtro, todos los juegos

    // Mapear juegos con conteo de "me gusta"
    const filtered = games.map((g) => {
      const gameVotes = votes[g.objectid] || {};
      const count = filterUsers.reduce((acc, user) => acc + (gameVotes[user] === 1 ? 1 : 0), 0);
      return { ...g, likesCount: count };
    });

    // Filtrar los que tengan al menos 1 "me gusta" y ordenar de mayor a menor
    return filtered
      .filter(g => g.likesCount > 0)
      .sort((a, b) => b.likesCount - a.likesCount);
  }



  // Manejar selección múltiple en filtro
  function handleSelectChange(e) {
    // Tomar todas las opciones seleccionadas
    const options = Array.from(e.target.selectedOptions).map(o => o.value);
    setFilterUsers(options); // guardar todas al mismo tiempo
  }


  // Quitar un usuario del filtro
  function removeFilterUser(user) {
    setFilterUsers((prev) => prev.filter((u) => u !== user));
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", fontFamily: "Arial, sans-serif", textAlign: "center" }}>
      <div style={{ maxWidth: "100vw", width: "100vw" }}>
        <h1 style={{ textAlign: "center" }}>🎲 Colección de Juegos</h1>

        <div style={{ marginBottom: "20px", textAlign: "center" }}>
          <input
            placeholder="Tu nombre/apodo"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: "20px", textAlign: "center" }}>
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

        <div style={{ display: "flex", justifyContent: "center" }}>
          <table style={{ borderCollapse: "collapse", margin: "20px", width: "90%" }}>
            <thead>
              <tr>
                <th style={{ border: "1px solid black", padding: "8px" }}>Juego</th>
                <th style={{ border: "1px solid black", padding: "8px" }}>Original</th>
                <th style={{ border: "1px solid black", padding: "8px" }}>Tipo</th>
                <th style={{ border: "1px solid black", padding: "8px" }}>Comentario</th>
                <th style={{ border: "1px solid black", padding: "8px" }}>Votar</th>
              </tr>
            </thead>
            <tbody>
              {getFilteredGames().map((g) => (
                <tr key={g.objectid}>
                  <td style={{ border: "1px solid black", padding: "8px" }}>
                    <a href={g.image_link} target="_blank">{g.objectname}</a>
                  </td>
                  <td style={{ border: "1px solid black", padding: "8px" }}>{g.originalname}</td>
                  <td style={{ border: "1px solid black", padding: "8px" }}>{g.itemtype}</td>
                  <td style={{ border: "1px solid black", padding: "8px" }}>{g.comment}</td>
                  <td style={{ border: "1px solid black", padding: "8px" }}>
                    {filterUsers.length === 0 ? (
                      <>
                        <button onClick={() => handleVote(g.objectid, 1)}>👍</button>
                        <button onClick={() => handleVote(g.objectid, -1)}>👎</button>
                      </>
                    ) : (
                      <span>{g.likesCount} 👍</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}