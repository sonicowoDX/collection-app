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
  const [expandedGames, setExpandedGames] = useState({});

  // 🔹 Nuevo: control de orden y tipo
  const [sortOption, setSortOption] = useState("name");
  const [filterType, setFilterType] = useState("all");

  // Función para alternar expansión
  function toggleExpand(objectid) {
    setExpandedGames(prev => ({
      ...prev,
      [objectid]: !prev[objectid]
    }));
  }

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

        // Obtener la colección existente del usuario
        const { data: existingCollection } = await supabase
          .from("collections")
          .select("collection_code")
          .eq("owner", username)
          .maybeSingle();

        let code;
        if (existingCollection) {
          // Ya existe colección → usar ese code
          code = existingCollection.collection_code;
          setCollectionCode(code);
          setOwner(username);

          // Juegos en la DB
          const { data: existingGames } = await supabase
            .from("games")
            .select("objectid")
            .eq("collection_code", code);

          const dbIds = new Set(existingGames.map((g) => g.objectid));
          const csvIds = new Set(rows.map((r) => r.objectid));

          // Borrar juegos que ya no estén en el CSV
          const toDelete = [...dbIds].filter((id) => !csvIds.has(id));
          if (toDelete.length > 0) {
            // Primero borrar votos de esos juegos
            await supabase.from("votes").delete()
              .eq("collection_code", code)
              .in("objectid", toDelete);

            // Luego borrar los juegos
            await supabase.from("games").delete()
              .eq("collection_code", code)
              .in("objectid", toDelete);
          }

          // Insertar solo los nuevos juegos
          const toInsert = rows.filter((r) => !dbIds.has(r.objectid));
          if (toInsert.length > 0) {
            const gamesData = await Promise.all(toInsert.map(async (r) => {
              const objectid = r.objectid;
              const slug = (r.originalname || r.objectname)
                .toLowerCase()
                .replace(/\s+/g, "-")
                .replace(/[^a-z0-9-]/g, "");
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
            }));

            await supabase.from("games").insert(gamesData);
          }
        } else {
          let code = collectionCode;

          if (!code) {
            if (existingCollection) {
              code = existingCollection.collection_code;
            } else {
              code = randomCollectionCode();
              await supabase.from("collections").insert({ owner: username, collection_code: code });
            }
          }

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

      // 🔹 Elegir usuarios relevantes (todos si no hay filtro)
      const relevantUsers = filterUsers.length > 0 ? filterUsers : votersList;

      let likes = 0,
        dislikes = 0,
        neutrals = 0,
        notPlayed = 0;
      
      let favoritesCount = 0;

      votersList.forEach((user) => {
        const v = gameVotes[user];
        if (v?.favorite) favoritesCount++;
      });

      // 🔹 Guardar también detalle de quién votó qué
      const detail = { likes: [], dislikes: [], neutrals: [], notPlayed: [] };

      relevantUsers.forEach((user) => {
        const v = gameVotes[user]?.vote;
        if (v === 1) {
          likes++;
          detail.likes.push(user);
        } else if (v === -1) {
          dislikes++;
          detail.dislikes.push(user);
        } else if (v === 0) {
          neutrals++;
          detail.neutrals.push(user);
        } else if (v === -2) {
          notPlayed++;
          detail.notPlayed.push(user);
        }
      });

      return { ...g, likes, dislikes, neutrals, notPlayed, detail, favoritesCount };
    });

    if (filterType === "base") {
      list = list.filter((g) => g.itemtype === "boardgame");
    } else if (filterType === "expansion") {
      list = list.filter((g) => g.itemtype.includes("expansion"));
    }

    if (sortOption === "name") {
      list.sort((a, b) => a.objectname.localeCompare(b.objectname));
    } else if (sortOption === "votes") {
      // 🔹 Ordenar solo con base en likes de usuarios relevantes
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
        <h2>Subir/actualizar colección (CSV exportado de la BGG)</h2>
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
              // 🔹 Vista normal: botones de voto
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
              // 🔹 Vista filtrada: detalle de usuarios seleccionados
              <div style={{ textAlign: "center", marginTop: "10px" }}>
              {/* Resumen en una sola línea */}
              <p style={{ cursor: "pointer", fontWeight: "bold" }}
                onClick={() => toggleExpand(g.objectid)}>
                ⭐ {g.favoritesCount} | 👍 {g.likes} | 👎 {g.dislikes} | 😐 {g.neutrals} | ❌ {g.notPlayed}
                {" "}
                <br />
                <span style={{ fontSize: "12px", color: "#999", textAlign: "center" }}>
                  ({expandedGames[g.objectid] ? "Ocultar" : "Ver detalle"})
                </span>
              </p>

              {/* Detalle colapsable */}
              {expandedGames[g.objectid] && (
                <div style={{ marginLeft: "10px", fontSize: "14px" }}>
                  <p>👍 {g.detail.likes.join(", ") || "—"}</p>
                  <p>👎 {g.detail.dislikes.join(", ") || "—"}</p>
                  <p>😐 {g.detail.neutrals.join(", ") || "—"}</p>
                  <p>❌ {g.detail.notPlayed.join(", ") || "—"}</p>
                </div>
              )}
            </div>
            )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: "20px", textAlign: "center" }}>
      <hr style={{ border: "1px solid #4b4b4b", margin: "10px 0" }} />
      <p>Si te gusta la app, ¡puedes apoyarme con una donación! - Reporta errores y/o sugerencias desde el formulario de abajo.</p>
      <a
        href="https://paypal.me/davidolivettopalomin"
        target="_blank"
        rel="noopener noreferrer"
        style={{ textDecoration: "none" }}
      >
        <img
          src="https://www.paypalobjects.com/webstatic/mktg/logo/pp_cc_mark_111x69.jpg"
          alt="Donar con PayPal"
          style={{ width: "100px", cursor: "pointer", filter: "grayscale(100%)" }}
        />
      </a>
      <a
        href="https://forms.gle/i6UKCkytCz61BJos8"
        target="_blank"
        rel="noopener noreferrer"
        style={{ textDecoration: "none" }}
      >
        <img
          src="https://cdn-icons-png.flaticon.com/512/2333/2333501.png"
          alt="Reportar error"
          style={{ width: "65px", cursor: "pointer", marginRight: "10px", filter: "grayscale(100%)", padding: "5px" }}
          
        />
      </a>
      <p>Creada por <strong>David Olivetto</strong></p>
    </div>
    </div>
  );
  
}
