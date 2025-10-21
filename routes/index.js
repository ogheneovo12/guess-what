const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  res.render("home", {
    error: req.query.error,
    success: req.query.success,
  });
});

module.exports = router;
