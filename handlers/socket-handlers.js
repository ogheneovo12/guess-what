const GameSession = require("../models/GameSession");

// Store active game timers to prevent duplicates
const activeTimers = new Map();

module.exports = (io) => {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);
    socket.on("create_session", handleCreateSession(socket, io));
    socket.on("join_session", handleJoinSession(socket, io));
    socket.on("set_question", handleSetQuestion(socket, io));
    socket.on("start_game", handleStartGame(socket, io));
    socket.on("submit_guess", handleSubmitGuess(socket, io));
    socket.on("chat_message", handleChatMessage(socket, io));
    socket.on("disconnect", handleDisconnect(socket, io));
    socket.on("start_next_round", handleStartNextRound(socket, io));
  });
};

// Helper function to clear game timer
function clearGameTimer(sessionId) {
  if (activeTimers.has(sessionId)) {
    clearTimeout(activeTimers.get(sessionId));
    activeTimers.delete(sessionId);
    console.log(`Cleared timer for session: ${sessionId}`);
  }
}

// Helper function to check if all players have exhausted attempts
function allPlayersExhausted(session) {
  const activePlayers = session.players.filter(
    (p) => p.isConnected && p.socketId !== session.gameMasterId
  );

  return (
    activePlayers.length > 0 && activePlayers.every((p) => p.attempts >= 3)
  );
}

// Helper function to assign/reassign game master
async function assignGameMaster(session, io, notifyClients = false) {
  const connectedPlayers = session.players.filter((p) => p.isConnected);

  if (connectedPlayers.length === 0) {
    session.requiresGameMaster = true;
    return null;
  }

  // Check if current game master is valid and connected
  const currentGameMaster = session.players.find(
    (p) => p.socketId === session.gameMasterId
  );
  const isGameMasterValid = currentGameMaster && currentGameMaster.isConnected;

  if (!isGameMasterValid) {
    // Sort by lastGameMasterTime to find who hasn't been master recently
    const sortedPlayers = connectedPlayers.sort((a, b) => {
      if (!a.lastGameMasterTime) return -1;
      if (!b.lastGameMasterTime) return 1;
      return a.lastGameMasterTime - b.lastGameMasterTime;
    });

    session.gameMasterId = sortedPlayers[0].socketId;
    session.requiresGameMaster = false;

    console.log(`Assigned new game master: ${sortedPlayers[0].username}`);

    if (notifyClients && io) {
      io.to(session.sessionId).emit("new_game_master", {
        gameMasterId: session.gameMasterId,
        gameMasterName: sortedPlayers[0].username,
        players: session.players,
      });

      io.to(session.sessionId).emit("players_update", {
        players: session.players,
        gameMasterId: session.gameMasterId,
      });
    }
  }

  return session.gameMasterId;
}

function handleCreateSession(socket, io) {
  return async ({ username, sessionId }) => {
    try {
      if (!username?.trim() || !sessionId?.trim()) {
        return socket.emit("error", {
          message: "Username and session ID are required",
        });
      }

      const trimmedSessionId = sessionId.trim().toLowerCase();
      const trimmedUsername = username.trim();

      const existingSession = await GameSession.findBySessionId(
        trimmedSessionId
      );
      if (existingSession) {
        return socket.emit("error", {
          message: "Session ID already exists. Please choose a different one.",
        });
      }

      const session = new GameSession({
        sessionId: trimmedSessionId,
        gameMasterId: socket.id,
        players: [
          {
            socketId: socket.id,
            username: trimmedUsername,
            score: 0,
            attempts: 0,
            isConnected: true,
            lastGameMasterTime: new Date(),
            lastActivity: new Date(),
          },
        ],
        requiresGameMaster: false,
      });

      await session.save();
      console.log("Session created:", session.sessionId);

      socket.join(session.sessionId);

      socket.emit("session_created", {
        sessionId: session.sessionId,
        username: trimmedUsername,
        isGameMaster: true,
      });

      io.to(session.sessionId).emit("players_update", {
        players: session.players,
        gameMasterId: session.gameMasterId,
      });
    } catch (error) {
      console.error("Create session error:", error);
      socket.emit("error", { message: "Failed to create session" });
    }
  };
}

function handleJoinSession(socket, io) {
  return async ({ username, sessionId }) => {
    try {
      if (!username?.trim() || !sessionId?.trim()) {
        return socket.emit("error", {
          message: "Username and session ID are required",
        });
      }

      const trimmedUsername = username.trim();
      const trimmedSessionId = sessionId.trim().toLowerCase();

      const session = await GameSession.findBySessionId(trimmedSessionId);
      if (!session) {
        return socket.emit("error", { message: "Session not found" });
      }

      // Check for reconnection
      const existingPlayer = session.players.find(
        (p) => p.username === trimmedUsername
      );
      let wasReconnected = false;

      if (existingPlayer) {
        // Player reconnecting
        existingPlayer.socketId = socket.id;
        existingPlayer.isConnected = true;
        existingPlayer.lastActivity = new Date();
        wasReconnected = true;
        console.log(`Player ${trimmedUsername} reconnected`);
      } else {
        // New player joining
        if (session.status === "in_progress") {
          return socket.emit("error", {
            message: "Game is in progress. Please wait for the next round.",
          });
        }

        session.players.push({
          socketId: socket.id,
          username: trimmedUsername,
          score: 0,
          attempts: 0,
          isConnected: true,
          lastGameMasterTime: null,
          lastActivity: new Date(),
        });
      }

      // Reassign game master if needed
      await assignGameMaster(session, io, true);
      await session.save();

      socket.join(session.sessionId);

      const isGameMaster = session.gameMasterId === socket.id;

      socket.emit(wasReconnected ? "session_reconnected" : "session_joined", {
        sessionId: session.sessionId,
        username: trimmedUsername,
        isGameMaster: isGameMaster,
        players: session.players,
        gameStatus: session.status,
        currentQuestion:
          session.status === "in_progress" ? session.currentQuestion : null,
      });

      io.to(session.sessionId).emit("players_update", {
        players: session.players,
        gameMasterId: session.gameMasterId,
      });

      io.to(session.sessionId).emit("chat_message", {
        type: "system",
        message: wasReconnected
          ? `${trimmedUsername} reconnected`
          : `${trimmedUsername} joined the game`,
      });

      // Notify game master about new player waiting
      if (session.gameMasterId && session.status === "waiting") {
        io.to(session.gameMasterId).emit("game_master_notification", {
          type: "player_joined",
          message: `${trimmedUsername} joined and is waiting for the game to start.`,
        });
      }
    } catch (error) {
      console.error("Join session error:", error);
      socket.emit("error", { message: "Failed to join session" });
    }
  };
}

function handleSetQuestion(socket, io) {
  return async ({ sessionId, question, answer }) => {
    try {
      if (!question?.trim() || !answer?.trim()) {
        return socket.emit("error", {
          message: "Question and answer are required",
        });
      }

      const session = await GameSession.findBySessionId(sessionId);
      if (!session) {
        return socket.emit("error", { message: "Session not found" });
      }

      if (session.gameMasterId !== socket.id) {
        return socket.emit("error", {
          message: "Only game master can set questions",
        });
      }

      if (session.status !== "waiting") {
        return socket.emit("error", {
          message: "Cannot set question while game is in progress",
        });
      }

      session.currentQuestion = question.trim();
      session.currentAnswer = answer.trim().toLowerCase();
      await session.save();

      socket.emit("question_set", {
        message: "Question set successfully! Ready to start.",
        question: session.currentQuestion,
        answer: session.currentAnswer
      });

      // Notify all players that game master has set a question
      io.to(sessionId).emit("player_notification", {
        type: "question_ready",
        message: "Game Master has set a question! Waiting for game to start...",
      });

      // Notify game master
      io.to(session.gameMasterId).emit("game_master_notification", {
        type: "question_set",
        message: "Question set! Players are waiting for you to start the game.",
      });
    } catch (error) {
      console.error("Set question error:", error);
      socket.emit("error", { message: "Failed to set question" });
    }
  };
}

function handleStartGame(socket, io) {
  return async ({ sessionId }) => {
    try {
      const session = await GameSession.findBySessionId(sessionId);
      if (!session) {
        return socket.emit("error", { message: "Session not found" });
      }

      if (session.gameMasterId !== socket.id) {
        return socket.emit("error", {
          message: "Only game master can start the game",
        });
      }

      const connectedPlayers = session.players.filter((p) => p.isConnected);
      if (connectedPlayers.length < 2) {
        return socket.emit("error", {
          message: "Need at least 2 connected players to start the game",
        });
      }

      if (!session.currentQuestion || !session.currentAnswer) {
        return socket.emit("error", {
          message: "Please set a question and answer first",
        });
      }

      if (session.status === "in_progress") {
        return socket.emit("error", {
          message: "Game is already in progress",
        });
      }

      // Reset all players' attempts
      session.players.forEach((p) => {
        p.attempts = 0;
      });

      session.status = "in_progress";
      session.gameStartTime = new Date();
      session.winner = null;
      await session.save();

      // Clear any existing timer
      clearGameTimer(sessionId);

      io.to(sessionId).emit("game_started", {
        question: session.currentQuestion,
        timeLimit: 60,
      });

      // Notify game master that players are guessing
      io.to(session.gameMasterId).emit("game_master_notification", {
        type: "game_started",
        message: "Game started! Players are now guessing...",
      });

      // Set new timer
      const timer = setTimeout(async () => {
        try {
          const updatedSession = await GameSession.findBySessionId(sessionId);
          if (updatedSession && updatedSession.status === "in_progress") {
            updatedSession.status = "ended";
            await updatedSession.save();

            io.to(sessionId).emit("game_ended", {
              reason: "timeout",
              answer: updatedSession.currentAnswer,
              players: updatedSession.players,
            });

            // Rotate game master immediately when time runs out
            await rotateGameMaster(sessionId, io);

            io.to(sessionId).emit("chat_message", {
              type: "system",
              message: "Time's up! No one guessed correctly.",
            });

            // Clear timer from map
            clearGameTimer(sessionId);
          }
        } catch (error) {
          console.error("Timer error:", error);
        }
      }, 60000);

      activeTimers.set(sessionId, timer);
    } catch (error) {
      console.error("Start game error:", error);
      socket.emit("error", { message: "Failed to start game" });
    }
  };
}

function handleSubmitGuess(socket, io) {
  return async ({ sessionId, guess }) => {
    try {
      if (!guess?.trim()) {
        return socket.emit("error", { message: "Please enter a guess" });
      }

      const session = await GameSession.findBySessionId(sessionId);
      if (!session) {
        return socket.emit("error", { message: "Session not found" });
      }

      if (session.status !== "in_progress") {
        return socket.emit("error", { message: "Game is not in progress" });
      }

      const player = session.players.find((p) => p.socketId === socket.id);
      if (!player) {
        return socket.emit("error", { message: "Player not found" });
      }

      // Check if player is game master
      if (socket.id === session.gameMasterId) {
        return socket.emit("error", {
          message: "Game master cannot submit guesses",
        });
      }

      if (player.attempts >= 3) {
        return socket.emit("error", {
          message: "You have used all your attempts",
        });
      }

      player.attempts++;
      const normalizedGuess = guess.trim().toLowerCase();
      const isCorrect = normalizedGuess === session.currentAnswer;

      if (isCorrect) {
        player.score += 10;
        session.status = "ended";
        session.winner = player.username;

        // Clear the game timer immediately
        clearGameTimer(sessionId);

        await session.save();

        io.to(sessionId).emit("game_ended", {
          reason: "winner",
          winner: player.username,
          answer: session.currentAnswer,
          players: session.players,
        });

        // Rotate game master immediately when someone wins
        await rotateGameMaster(sessionId, io);

        io.to(sessionId).emit("chat_message", {
          type: "system",
          message: `🎉 ${player.username} won the round!`,
        });
      } else {
        await session.save();

        socket.emit("guess_result", {
          correct: false,
          attemptsLeft: 3 - player.attempts,
        });

        io.to(sessionId).emit("chat_message", {
          type: "system",
          message: `${player.username} made a guess (${player.attempts}/3 attempts)`,
        });

        // Notify game master about the guess
        if (session.gameMasterId) {
          io.to(session.gameMasterId).emit("game_master_notification", {
            type: "player_guessed",
            message: `${player.username} submitted a guess (${player.attempts}/3 attempts used)`,
          });
        }

        // Check if all players have exhausted attempts
        if (allPlayersExhausted(session)) {
          session.status = "ended";
          await session.save();

          // Clear the game timer
          clearGameTimer(sessionId);

          io.to(sessionId).emit("game_ended", {
            reason: "all_attempts_used",
            answer: session.currentAnswer,
            players: session.players,
          });

          // Rotate game master immediately when all attempts are used
          await rotateGameMaster(sessionId, io);

          io.to(sessionId).emit("chat_message", {
            type: "system",
            message: "All players have used their attempts! Round ended.",
          });
        }
      }
    } catch (error) {
      console.error("Submit guess error:", error);
      socket.emit("error", { message: "Failed to submit guess" });
    }
  };
}

function handleChatMessage(socket, io) {
  return async ({ sessionId, message }) => {
    try {
      if (!message?.trim()) return;

      const session = await GameSession.findBySessionId(sessionId);
      if (!session) return;

      const player = session.players.find((p) => p.socketId === socket.id);
      if (!player) return;

      io.to(sessionId).emit("chat_message", {
        type: "user",
        username: player.username,
        message: message.trim(),
      });
    } catch (error) {
      console.error("Chat error:", error);
    }
  };
}

function handleStartNextRound(socket, io) {
  return async ({ sessionId }) => {
    try {
      const session = await GameSession.findBySessionId(sessionId);
      if (!session) {
        return socket.emit("error", { message: "Session not found" });
      }

      if (session.gameMasterId !== socket.id) {
        return socket.emit("error", {
          message: "Only game master can start the next round",
        });
      }

      // Reset game state but keep players and scores
      session.status = "waiting";
      session.currentQuestion = null;
      session.currentAnswer = null;
      session.winner = null;
      session.gameStartTime = null;

      // Reset attempts for all players
      session.players.forEach((player) => {
        player.attempts = 0;
      });

      await session.save();

      // Notify all players that next round is starting
      io.to(sessionId).emit("next_round_starting", {
        gameMasterId: session.gameMasterId,
        gameMasterName: session.players.find(
          (p) => p.socketId === session.gameMasterId
        )?.username,
      });
    } catch (error) {
      console.error("Start next round error:", error);
      socket.emit("error", { message: "Failed to start next round" });
    }
  };
}

function handleDisconnect(socket, io) {
  return async () => {
    try {
      console.log("User disconnected:", socket.id);

      const sessions = await GameSession.find({
        "players.socketId": socket.id,
      });

      for (const session of sessions) {
        const player = session.players.find((p) => p.socketId === socket.id);
        if (!player) continue;

        console.log(
          `Player ${player.username} disconnected from session ${session.sessionId}`
        );

        player.isConnected = false;
        player.lastActivity = new Date();

        // If game master disconnected, reassign immediately
        const wasGameMaster = session.gameMasterId === socket.id;

        if (wasGameMaster) {
          await assignGameMaster(session, io, true);

          // If game was in progress and GM disconnected, end the game
          if (session.status === "in_progress") {
            clearGameTimer(session.sessionId);
            session.status = "ended";

            io.to(session.sessionId).emit("game_ended", {
              reason: "timeout",
              answer: session.currentAnswer,
              players: session.players,
            });

            // Rotate game master immediately
            await rotateGameMaster(session.sessionId, io);

            io.to(session.sessionId).emit("chat_message", {
              type: "system",
              message: "Game master disconnected. Round ended.",
            });
          }
        }

        await session.save();

        io.to(session.sessionId).emit("players_update", {
          players: session.players,
          gameMasterId: session.gameMasterId,
        });

        io.to(session.sessionId).emit("chat_message", {
          type: "system",
          message: `${player.username} disconnected`,
        });
      }
    } catch (error) {
      console.error("Disconnect error:", error);
    }
  };
}

async function rotateGameMaster(sessionId, io) {
  try {
    const session = await GameSession.findBySessionId(sessionId);
    if (!session) return;

    const connectedPlayers = session.players.filter((p) => p.isConnected);
    if (connectedPlayers.length === 0) {
      session.requiresGameMaster = true;
      await session.save();
      return;
    }

    // Find current game master index
    const currentMasterIndex = session.players.findIndex(
      (p) => p.socketId === session.gameMasterId
    );

    // Sort connected players by lastGameMasterTime (who hasn't been GM recently)
    const sortedConnectedPlayers = connectedPlayers.sort((a, b) => {
      if (!a.lastGameMasterTime) return -1;
      if (!b.lastGameMasterTime) return 1;
      return a.lastGameMasterTime - b.lastGameMasterTime;
    });

    // Find next game master (first connected player who hasn't been GM recently)
    let nextGameMaster = sortedConnectedPlayers[0];

    // If current GM is still connected, try to pick next person
    if (
      currentMasterIndex !== -1 &&
      session.players[currentMasterIndex].isConnected
    ) {
      const otherPlayers = sortedConnectedPlayers.filter(
        (p) => p.socketId !== session.gameMasterId
      );
      if (otherPlayers.length > 0) {
        nextGameMaster = otherPlayers[0];
      }
    }

    session.gameMasterId = nextGameMaster.socketId;
    nextGameMaster.lastGameMasterTime = new Date();
    session.status = "ended"; // Keep as ended until new GM starts next round
    session.requiresGameMaster = false;

    await session.save();

    io.to(sessionId).emit("new_game_master", {
      gameMasterId: session.gameMasterId,
      gameMasterName: nextGameMaster.username,
      players: session.players,
    });

    io.to(sessionId).emit("players_update", {
      players: session.players,
      gameMasterId: session.gameMasterId,
    });

    io.to(sessionId).emit("chat_message", {
      type: "system",
      message: `${nextGameMaster.username} is now the Game Master`,
    });

    // Notify the new game master
    io.to(session.gameMasterId).emit("game_master_notification", {
      type: "new_game_master",
      message:
        "You are now the Game Master! Click 'Start Next Round' to begin.",
    });
  } catch (error) {
    console.error("Rotate game master error:", error);
  }
}
