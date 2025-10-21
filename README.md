# 🎮 Guess What? - Multiplayer Guessing Game

A real-time multiplayer guessing game built with Node.js, Express, Socket.IO, and MongoDB. Players can create or join game sessions, take turns being the Game Master, and compete to guess answers correctly.

## 🚀 Features

### Core Gameplay
- **Real-time Multiplayer**: Live game sessions with WebSocket connections
- **Game Master Role**: Rotating game master who sets questions and answers
- **Guessing Mechanics**: Players get 3 attempts per round to guess the answer
- **Timer System**: 60-second countdown for each round
- **Score Tracking**: Points awarded for correct guesses
- **Chat System**: In-game chat for player communication

### Session Management
- **Persistent Sessions**: Game sessions remain active across page navigation
- **Player Reconnection**: Players can reconnect without losing progress
- **Auto Game Master Assignment**: Intelligent game master rotation system
- **Session Cleanup**: Automatic cleanup of old sessions after 24 hours

### User Experience
- **Responsive Design**: Works on desktop and mobile devices
- **Real-time Notifications**: Game master and player notifications
- **Live Player List**: See who's online and their scores
- **Game Status Updates**: Real-time updates on game progress

## 🛠️ Technology Stack

- **Backend**: Node.js, Express.js
- **Real-time Communication**: Socket.IO
- **Database**: MongoDB with Mongoose ODM
- **Template Engine**: Handlebars with custom helpers
- **Frontend**: Vanilla JavaScript, CSS3 with gradients and animations

## 📁 Project Structure

```
guess-what/
├── models/
│   └── GameSession.js          # MongoDB schema and model
├── routes/
│   ├── index.js               # Home page routes
│   └── game.js                # Game page routes
├── views/
│   ├── layouts/
│   │   └── main.hbs           # Main layout template
│   ├── home.hbs               # Home page template
│   └── game.hbs               # Game page template
├── handlers/
│   └── socket-handlers.js     # Socket.IO event handlers
├── public/                    # Static assets
├── server.js                  # Application entry point
└── package.json
```

## 🔧 Installation & Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/ogheneovo12/guess-what.git
   cd guess-what
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   Create a `.env` file in the root directory:
   ```env
   DATABASE_URL=mongodb://localhost:27017/guess-what
   PORT=3000
   ```

4. **Start the application**
   ```bash
   # Development mode
   npm run dev
   
   # Production mode
   npm start
   ```

5. **Access the application**
   Open `http://localhost:3000` in your browser

## 🎯 How to Play

1. **Create/Join Session**
   - Enter your username and a session ID
   - Create a new session or join an existing one
   - Share the session ID with friends

2. **Game Master Role**
   - First player becomes the Game Master
   - Game Master sets a question and answer
   - Starts the game when ready

3. **Guessing Phase**
   - Players have 60 seconds and 3 attempts to guess
   - Correct guess awards 10 points
   - Game ends when time runs out or someone guesses correctly

4. **Next Round**
   - Game Master role rotates to another player
   - New Game Master starts the next round
   - Scores persist across rounds

## 🗄️ Database Design

### GameSession Schema
```javascript
{
  sessionId: String,           // Unique session identifier
  players: [Player],           // Array of player objects
  gameMasterId: String,        // Current game master's socket ID
  currentQuestion: String,     // Current round's question
  currentAnswer: String,       // Current round's answer
  status: String,              // waiting, in_progress, ended
  winner: String,              // Round winner username
  createdAt: Date,             // Session creation timestamp
  updatedAt: Date              // Last activity timestamp
}
```

### Player Schema
```javascript
{
  socketId: String,            // Player's socket connection ID
  username: String,            // Player's display name
  score: Number,               // Total points
  attempts: Number,            // Attempts used in current round
  isConnected: Boolean,        // Online status
  lastGameMasterTime: Date,    // Last time as game master
  lastActivity: Date           // Last interaction timestamp
}
```

## 🔄 Session & Player Persistence Strategy

### Why We Don't Delete on Disconnect

This application employs a **persistence strategy** rather than immediate deletion for several important reasons:

#### 1. **Multi-Page Application Navigation**
```javascript
// Players navigate between pages without losing session context
window.location.href = `/game/${data.sessionId}?username=${data.username}`;
```
- Users redirect between home page and game page
- Immediate deletion would remove sessions during normal navigation
- Players need to maintain their identity and game state

#### 2. **Player Reconnection Support**
```javascript
// Handle player reconnection
const existingPlayer = session.players.find(p => p.username === trimmedUsername);
if (existingPlayer) {
  existingPlayer.socketId = socket.id;
  existingPlayer.isConnected = true;
  // Preserve score, attempts, and game history
}
```
- Players can reconnect after network issues or page refreshes
- Scores and game progress are preserved
- Game state remains consistent for all players

#### 3. **Game Continuity**
```javascript
// Mark players as disconnected instead of deleting
player.isConnected = false;
player.lastActivity = new Date();
```
- Games can continue with disconnected players marked as offline
- Reconnected players can resume participation
- No disruption to active game sessions

#### 4. **State Management**
Instead of deletion, we use:
- **Connection Status Tracking**: `isConnected` flag
- **Activity Timestamps**: `lastActivity` for cleanup decisions
- **Session Timeouts**: 24-hour automatic cleanup
- **Game Master Reassignment**: Automatic when GM disconnects

#### 5. **Cleanup Strategy**
```javascript
// Auto-delete after 24 hours of inactivity
gameSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

// Manual cleanup of old disconnected sessions
gameSessionSchema.statics.cleanupOldSessions = async function() {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return this.deleteMany({
    updatedAt: { $lt: oneDayAgo },
    "players.isConnected": false
  });
};
```

## 🎮 Socket.IO Events

### Client to Server
- `create_session` - Create new game session
- `join_session` - Join existing session
- `set_question` - Game Master sets question/answer
- `start_game` - Begin the guessing round
- `submit_guess` - Player submits guess
- `chat_message` - Send chat message
- `start_next_round` - Start new round

### Server to Client
- `session_created` / `session_joined` - Session connection events
- `players_update` - Player list changes
- `game_started` - Round begins
- `guess_result` - Guess validation result
- `game_ended` - Round completion
- `chat_message` - New chat message
- `new_game_master` - Game master rotation

## 🚦 Game Flow

1. **Session Creation** → Player creates/joins session
2. **Game Master Setup** → GM sets question and answer
3. **Game Start** → 60-second timer begins
4. **Guessing Phase** → Players submit guesses (max 3 attempts)
5. **Round End** → Timeout, correct guess, or all attempts used
6. **Role Rotation** → New Game Master assigned
7. **Next Round** → Process repeats with new GM

## 🔒 Error Handling

- Input validation for usernames and session IDs
- Duplicate username prevention
- Game state validation (can't start without question, etc.)
- Connection loss recovery
- Invalid action prevention (non-GM starting game, etc.)

## 🎨 UI/UX Features

- **Responsive Grid Layout**: Adapts to different screen sizes
- **Real-time Updates**: Live player list and score updates
- **Visual Feedback**: Success/error messages, notifications
- **Game Status Indicators**: Clear visual cues for game state
- **Smooth Animations**: CSS transitions and animations

## 📱 Mobile Support

- Responsive design using CSS Grid and Flexbox
- Touch-friendly buttons and inputs
- Optimized layout for mobile screens
- Maintains all functionality on mobile devices

## 🔮 Future Enhancements

- [ ] Private sessions with passwords
- [ ] Customizable game settings (time limits, attempts)
- [ ] Player avatars and profiles
- [ ] Game history and statistics
- [ ] Sound effects and themes
- [ ] Spectator mode
- [ ] Team-based gameplay

## 📄 License

ISC License

---

**Built with ❤️ using Node.js, Express, Socket.IO, and MongoDB**