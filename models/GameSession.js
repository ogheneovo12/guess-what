const mongoose = require("mongoose");

const playerSchema = new mongoose.Schema({
  socketId: { type: String, required: true },
  username: { 
    type: String, 
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 20
  },
  score: { type: Number, default: 0, min: 0 },
  attempts: { type: Number, default: 0, min: 0, max: 3 },
  isConnected: { type: Boolean, default: true },
  lastGameMasterTime: { type: Date, default: null },
  lastActivity: { type: Date, default: Date.now },
});

const gameSessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    minlength: 3,
    maxlength: 20,
    index: true,
  },
  requiresGameMaster: { type: Boolean, default: false },
  players: [playerSchema],
  gameMasterId: { type: String, default: null },
  currentQuestion: { type: String, default: null },
  currentAnswer: { type: String, default: null },
  status: {
    type: String,
    enum: ["waiting", "in_progress", "ended"],
    default: "waiting",
    index: true,
  },
  winner: { type: String, default: null },
  gameStartTime: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
});

// Indexes for performance
gameSessionSchema.index({ sessionId: 1, status: 1 });
gameSessionSchema.index({ "players.socketId": 1 });
gameSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 }); // Auto-delete after 24 hours

// Update the updatedAt field before saving
gameSessionSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Validation: Ensure at least one player exists
gameSessionSchema.pre("save", function (next) {
  if (this.players.length === 0 && this.status !== "waiting") {
    return next(new Error("Session must have at least one player"));
  }
  next();
});

// Static method to find active session
gameSessionSchema.statics.findBySessionId = function (sessionId) {
  return this.findOne({ sessionId: sessionId.toLowerCase().trim() });
};

// Static method to clean up old disconnected sessions
gameSessionSchema.statics.cleanupOldSessions = async function () {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return this.deleteMany({
    updatedAt: { $lt: oneDayAgo },
    "players.isConnected": false,
  });
};

// Instance method to add player
gameSessionSchema.methods.addPlayer = function (playerData) {
  // Check if username already exists
  const existingPlayer = this.players.find(
    (p) => p.username === playerData.username
  );
  if (existingPlayer) {
    throw new Error("Username already exists in this session");
  }
  
  this.players.push(playerData);
  return this.save();
};

// Instance method to remove player
gameSessionSchema.methods.removePlayer = function (socketId) {
  this.players = this.players.filter((p) => p.socketId !== socketId);
  return this.save();
};

// Instance method to get connected players
gameSessionSchema.methods.getConnectedPlayers = function () {
  return this.players.filter((p) => p.isConnected);
};

// Instance method to reset game state
gameSessionSchema.methods.resetGame = function () {
  this.status = "waiting";
  this.currentQuestion = null;
  this.currentAnswer = null;
  this.winner = null;
  this.gameStartTime = null;
  this.players.forEach((p) => {
    p.attempts = 0;
  });
  return this;
};

module.exports = mongoose.model("GameSession", gameSessionSchema);