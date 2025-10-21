const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");
const { engine } = require("express-handlebars");
const gameSocketHandler = require("./handlers/socket-handlers");

dotenv.config({ path: ".env" });

const app = express();
const server = http.createServer(app);


const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.DATABASE_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    
    // Connection event listeners
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
    });
    
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }
};

connectDB();


app.engine(
  "hbs",
  engine({
    defaultLayout: "main",
    layoutsDir: path.join(__dirname, "views/layouts"),
    helpers: {
      contentFor: function (name, options) {
        if (!this._blocks) this._blocks = {};
        this._blocks[name] = options.fn(this);
        return null;
      },
      block: function (name) {
        return this._blocks && this._blocks[name] ? this._blocks[name] : "";
      },
    },
    extname: ".hbs",
  })
);
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));

// Middleware
app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/", require("./routes/index"));
app.use("/game", require("./routes/game"));

// Socket.io setup
const io = require("socket.io")(server);
gameSocketHandler(io)

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});