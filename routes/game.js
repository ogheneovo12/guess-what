const express = require("express");
const GameSession = require("../models/GameSession");
const router = express.Router();

router.get("/:sessionId", async (req, res) => {
  try {
    const session = await GameSession.findBySessionId(req.params.sessionId);
    if (!session) {
      return res.redirect(`/?error=Session not found`);
    }
    
    // Allow access if user is joining via redirect (username in query)
    // The socket connection will handle the actual player joining
    if (req.query.username) {
      return res.render("game", {
        sessionId: session.sessionId,
        username: req.query.username,
      });
    }
    
    // If no username provided, redirect to home
    return res.redirect(`/?error=Username required to join game`);
  } catch (error) {
    console.error(error);
    return res.redirect(`/?error=Internal Server Error`);
  }
});

module.exports = router;
